"use strict";

const libxmljs = require("libxmljs");
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


function createSoapDocument(id) {
  let xml = libxmljs.Document();
  let env = xml.node("soap-env:Envelope");

  for (let prefix in NAMESPACES)
    env.defineNamespace(prefix, NAMESPACES[prefix]);

  let header = env.node("soap-env:Header");

  header.node("cwmp:ID").attr({
    "soap-env:mustUnderstand": 1
  }).text(id);

  env.node("soap-env:Body");

  return xml;
}


function sendRequest(xml, callback) {
  let headers = {};
  let body = "";

  if (xml)
    body = xml.toString();

  headers["Content-Length"] = body.length;
  headers["Content-Type"] = "text/xml; charset=\"utf-8\"";

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
      body = new Buffer(bytes);

      chunks.forEach(function(chunk) {
        chunk.copy(body, offset, 0, chunk.length);
        return offset += chunk.length;
      });

      if (+response.headers["Content-Length"] > 0 || body.length > 0)
        xml = libxmljs.parseXml(body);
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
  const xmlOut = createSoapDocument(requestId);

  methods.inform(device, xmlOut, event, function(xml) {
    sendRequest(xml, function(xml) {
      cpeRequest();
    });
  });
}


function createFaultResponse(xmlOut, code, message) {
  let body = xmlOut.root().childNodes()[1];

  let soapFault = body.node("soap-env:Fault");
  soapFault.node("faultcode").text("Client");
  soapFault.node("faultstring").text("CWMP fault");

  let fault = soapFault.node("detail").node("cwmp:Fault");
  fault.node("FaultCode").text(code);

  return fault.node("FaultString").text(message);
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
  const xmlOut = createSoapDocument(requestId);

  pending(xmlOut, function(xml, callback) {
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

  let requestId = xml.get("/soap-env:Envelope/soap-env:Header/cwmp:ID", NAMESPACES).text();
  let xmlOut = createSoapDocument(requestId);
  let element = xml.get("/soap-env:Envelope/soap-env:Body/cwmp:*", NAMESPACES);
  let method = methods[element.name()];

  if (!method) {
    createFaultResponse(xmlOut, 9000, "Method not supported");
    sendRequest(xmlOut, function(xml) {
      handleMethod(xml);
    });
    return;
  }

  methods[element.name()](device, xml, xmlOut, function(xml) {
    sendRequest(xml, function(xml) {
      handleMethod(xml);
    });
  });
}


function createHttpServer(serialNumber, ip, port, callback) {
  const connectionRequestUrl = `http://${ip}:${port}/`;

  const httpServer = http.createServer((_req, res) => {
    connectionRequestInform();
    console.log(`Simulator ${serialNumber}: Connection request;`);
    res.end("");
  });

  httpServer.listen(port, err => {
    if (err) return callback(err);
    console.log(
      `Simulator ${serialNumber} listening to ${connectionRequestUrl}`
    );
    return callback(null, connectionRequestUrl);
  });
}

function start(dataModel, serialNumber, acsUrl, httpPort) {
  device = dataModel;

  if (device["Device.DeviceInfo.SerialNumber"])
    device["Device.DeviceInfo.SerialNumber"][1] = serialNumber;
  else if (device["InternetGatewayDevice.DeviceInfo.SerialNumber"])
    device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1] = serialNumber;

  requestOptions = require("url").parse(acsUrl);
  http = require(requestOptions.protocol.slice(0, -1));
  httpAgent = new http.Agent({keepAlive: true, maxSockets: 1});

  // start a dummy socket to get the used local ip
  let socket = httpAgent.createConnection({});
  socket.connect({
    port: requestOptions.port,
    host: requestOptions.hostname,
    family: 4
  }, () => {
    const ip = socket.address().address;
    socket.on("close", () => {
      createHttpServer(
        serialNumber,
        ip,
        httpPort,
        (err, connectionRequestUrl) => {
          if (err) throw err;
          if (device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"]) {
            device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
          } else if (device["Device.ManagementServer.ConnectionRequestURL"]) {
            device["Device.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
          }

          startSession();
        }
      );
    });

    socket.end();
  });
}

function connectionRequestInform() {
  // A session is ongoing when nextInformTimeout === null
  if (nextInformTimeout === null) pendingInform = true;
  else {
    clearTimeout(nextInformTimeout);
    nextInformTimeout = setTimeout(function () {
      startSession("6 CONNECTION REQUEST");
    }, 0);
  }
}

exports.start = start;
