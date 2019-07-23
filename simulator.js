"use strict";

const net = require("net");
const xmlParser = require("./xml-parser");
const xmlUtils = require("./xml-utils");
const methods = require("./methods");

const NAMESPACES = {
  "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
  "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
  "xsd": "http://www.w3.org/2001/XMLSchema",
  "xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "cwmp": "urn:dslforum-org:cwmp-1-0"
};

let nextInformTimeout = null;
let pendingInform = false;
let http = null;
let requestOptions = null;
let device = null;
let httpAgent = null;
let basicAuth;


function createSoapDocument(id, body) {
  let headerNode = xmlUtils.node(
    "soap-env:Header",
    {},
    xmlUtils.node("cwmp:ID", { "soap-env:mustUnderstand": 1 }, xmlParser.encodeEntities(id))
  );

  let bodyNode = xmlUtils.node("soap-env:Body", {}, body);
  let namespaces = {};
  for (let prefix in NAMESPACES)
    namespaces[`xmlns:${prefix}`] = NAMESPACES[prefix];
  
  let env = xmlUtils.node("soap-env:Envelope", namespaces, [headerNode, bodyNode]);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${env}`;
}

function sendRequest(xml, callback) {
  let headers = {};
  let body = xml || "";

  headers["Content-Length"] = body.length;
  headers["Content-Type"] = "text/xml; charset=\"utf-8\"";
  headers["Authorization"]= basicAuth;

  if (device._cookie)
    headers["Cookie"] = device._cookie;

  let options = {
    method: "POST",
    headers: headers,
    agent: httpAgent
  };

  Object.assign(options, requestOptions);

  let request = http.request(options, function(response) {
    let chunks = [];
    let bytes = 0;

    response.on("data", function(chunk) {
      chunks.push(chunk);
      return bytes += chunk.length;
    });

    return response.on("end", function() {
      let offset = 0;
      body = Buffer.allocUnsafe(bytes);

      chunks.forEach(function(chunk) {
        chunk.copy(body, offset, 0, chunk.length);
        return offset += chunk.length;
      });

      if (Math.floor(response.statusCode / 100) !== 2) {
        throw new Error(
          `Unexpected response Code ${response.statusCode}: ${body}`
        );
      }

      if (+response.headers["Content-Length"] > 0 || body.length > 0)
        xml = xmlParser.parseXml(body.toString());
      else
        xml = null;

      if (response.headers["set-cookie"])
        device._cookie = response.headers["set-cookie"];

      return callback(xml);
    });
  });

  request.setTimeout(30000, function(err) {
    throw new Error("Socket timed out");
  });

  return request.end(body);
}

function startSession(event) {
  nextInformTimeout = null;
  pendingInform = false;
  const requestId = Math.random().toString(36).slice(-8);

  methods.inform(device, event, function(body) {
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      cpeRequest();
    });
  });
}


function createFaultResponse(code, message) {
  let fault = xmlUtils.node(
    "detail",
    {},
    xmlUtils.node("cwmp:Fault", {}, [
      xmlUtils.node("FaultCode", {}, code),
      xmlUtils.node("FaultString", {}, xmlParser.encodeEntities(message))
    ])
  );

  let soapFault = xmlUtils.node("soap-env:Fault", {}, [
    xmlUtils.node("faultcode", {}, "Client"),
    xmlUtils.node("faultstring", {}, "CWMP fault"),
    fault
  ]);

  return soapFault;
}


function cpeRequest() {
  const pending = methods.getPending();
  if (!pending) {
    sendRequest(null, function(xml) {
      handleMethod(xml);
    });
    return;
  }

  const requestId = Math.random().toString(36).slice(-8);

  pending(function(body, callback) {
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      callback(xml, cpeRequest);
    });
  });
}


function handleMethod(xml) {
  if (!xml) {
    httpAgent.destroy();
    let informInterval = 10;
    if (device["Device.ManagementServer.PeriodicInformInterval"])
      informInterval = parseInt(device["Device.ManagementServer.PeriodicInformInterval"][1]);
    else if (device["InternetGatewayDevice.ManagementServer.PeriodicInformInterval"])
      informInterval = parseInt(device["InternetGatewayDevice.ManagementServer.PeriodicInformInterval"][1]);

    nextInformTimeout = setTimeout(function() {
      startSession();
    }, pendingInform ? 0 : 1000 * informInterval);

    return;
  }

  let headerElement, bodyElement;
  let envelope = xml.children[0];
  for (const c of envelope.children) {
    switch (c.localName) {
      case "Header":
        headerElement = c;
        break;
      case "Body":
        bodyElement = c;
        break;
    }
  }

  let requestId;
  for (let c of headerElement.children) {
    if (c.localName === "ID") {
      requestId = xmlParser.decodeEntities(c.text);
      break;
    }
  }

  let requestElement;
  for (let c of bodyElement.children) {
    if (c.name.startsWith("cwmp:")) {
      requestElement = c;
      break;
    }
  }
  let method = methods[requestElement.localName];

  if (!method) {
    let body = createFaultResponse(9000, "Method not supported");
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      handleMethod(xml);
    });
    return;
  }

  method(device, requestElement, function(body) {
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      handleMethod(xml);
    });
  });
}

function listenForConnectionRequests(serialNumber, acsUrlOptions, callback) {
  let ip, port;
  // Start a dummy socket to get the used local ip
  let socket = net.createConnection({
    port: acsUrlOptions.port,
    host: acsUrlOptions.hostname,
    family: 4
  })
  .on("error", callback)
  .on("connect", () => {
    ip = socket.address().address;
    port = socket.address().port + 1;
    socket.end();
  })
  .on("close", () => {
    const connectionRequestUrl = `http://${ip}:${port}/`;

    const httpServer = http.createServer((_req, res) => {
      console.log(`Simulator ${serialNumber} got connection request`);
      res.end();
        // A session is ongoing when nextInformTimeout === null
        if (nextInformTimeout === null) pendingInform = true;
        else {
          clearTimeout(nextInformTimeout);
          nextInformTimeout = setTimeout(function () {
            startSession("6 CONNECTION REQUEST");
          }, 0);
        }
    });

    httpServer.listen(port, ip, err => {
      if (err) return callback(err);
      console.log(
        `Simulator ${serialNumber} listening for connection requests on ${connectionRequestUrl}`
      );
      return callback(null, connectionRequestUrl);
    });
  });
}

function start(dataModel, serialNumber, acsUrl) {
  device = dataModel;

  if (device["DeviceID.SerialNumber"])
    device["DeviceID.SerialNumber"][1] = serialNumber;
  if (device["Device.DeviceInfo.SerialNumber"])
    device["Device.DeviceInfo.SerialNumber"][1] = serialNumber;
  if (device["InternetGatewayDevice.DeviceInfo.SerialNumber"])
    device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1] = serialNumber;

  let username = "";
  let password = "";
  if (device["Device.ManagementServer.Username"]) {
    username = device["Device.ManagementServer.Username"][1];
    password = device["Device.ManagementServer.Password"][1];
  } else if (device["InternetGatewayDevice.ManagementServer.Username"]) {
    username = device["InternetGatewayDevice.ManagementServer.Username"][1];
    password = device["InternetGatewayDevice.ManagementServer.Password"][1];
  }

  basicAuth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  requestOptions = require("url").parse(acsUrl);
  http = require(requestOptions.protocol.slice(0, -1));
  httpAgent = new http.Agent({keepAlive: true, maxSockets: 1});

  listenForConnectionRequests(serialNumber, requestOptions, (err, connectionRequestUrl) => {
    if (err) throw err;
    if (device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"]) {
      device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
    } else if (device["Device.ManagementServer.ConnectionRequestURL"]) {
      device["Device.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
    }
    startSession();
  });
}

exports.start = start;
