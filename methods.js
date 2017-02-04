"use strict";

const NAMESPACES = {
  "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
  "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
  "xsd": "http://www.w3.org/2001/XMLSchema",
  "xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "cwmp": "urn:dslforum-org:cwmp-1-0"
};

const INFORM_PARAMS = [
  "Device.DeviceInfo.SpecVersion",
  "InternetGatewayDevice.DeviceInfo.SpecVersion",
  "Device.DeviceInfo.HardwareVersion",
  "InternetGatewayDevice.DeviceInfo.HardwareVersion",
  "Device.DeviceInfo.SoftwareVersion",
  "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
  "Device.DeviceInfo.ProvisioningCode",
  "InternetGatewayDevice.DeviceInfo.ProvisioningCode",
  "Device.ManagementServer.ParameterKey",
  "InternetGatewayDevice.ManagementServer.ParameterKey",
  "Device.ManagementServer.ConnectionRequestURL",
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL",
  "Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
  "Device.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress"
];


function inform(device, xmlOut, callback) {
  let body = xmlOut.root().childNodes()[1];
  let inform = body.node("cwmp:Inform");
  let deviceId = inform.node("DeviceId");

  if (device["Device.DeviceInfo.Manufacturer"])
    deviceId.node("Manufacturer", device["Device.DeviceInfo.Manufacturer"][1]);
  else if (device["InternetGatewayDevice.DeviceInfo.Manufacturer"])
    deviceId.node("Manufacturer", device["InternetGatewayDevice.DeviceInfo.Manufacturer"][1]);

  if (device["Device.DeviceInfo.ManufacturerOUI"])
    deviceId.node("OUI", device["Device.DeviceInfo.ManufacturerOUI"][1]);
  else if (device["InternetGatewayDevice.DeviceInfo.ManufacturerOUI"])
    deviceId.node("OUI", device["InternetGatewayDevice.DeviceInfo.ManufacturerOUI"][1]);

  if (device["Device.DeviceInfo.ProductClass"])
    deviceId.node("ProductClass", device["Device.DeviceInfo.ProductClass"][1]);
  else if (device["InternetGatewayDevice.DeviceInfo.ProductClass"])
    deviceId.node("ProductClass", device["InternetGatewayDevice.DeviceInfo.ProductClass"][1]);

  if (device["Device.DeviceInfo.SerialNumber"])
    deviceId.node("SerialNumber", device["Device.DeviceInfo.SerialNumber"][1]);
  else if (device["InternetGatewayDevice.DeviceInfo.SerialNumber"])
    deviceId.node("SerialNumber", device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1]);

  let eventStruct = inform.node("Event").attr({
    "soap-enc:arrayType": "cwmp:EventStruct[1]"
  }).node("EventStruct");

  eventStruct.node("EventCode", "2 PERIODIC");
  eventStruct.node("CommandKey");

  inform.node("MaxEnvelopes", "1");
  inform.node("CurrentTime", new Date().toISOString());
  inform.node("RetryCount", "0");

  let parameterList = inform.node("ParameterList").attr({
    "soap-enc:arrayType": "cwmp:ParameterValueStruct[7]"
  });

  for (let p of INFORM_PARAMS) {
    let param = device[p];
    if (!param)
      continue;

    let parameterValueStruct = parameterList.node("ParameterValueStruct");
    parameterValueStruct.node("Name", p);
    parameterValueStruct.node("Value", param[1]).attr({"xsi:type": param[2]});
  }

  return callback(xmlOut);
}


function getSortedPaths(device) {
  if (!device._sortedPaths)
    device._sortedPaths = Object.keys(device).filter(p => p[0] !== "_").sort();
  return device._sortedPaths;
}


function GetParameterNames(device, xmlIn, xmlOut, callback) {
  let parameterNames = getSortedPaths(device);
  let parameterPath = xmlIn.get("/soap-env:Envelope/soap-env:Body/cwmp:GetParameterNames/ParameterPath", NAMESPACES).text();
  let nextLevel = Boolean(JSON.parse(xmlIn.get("/soap-env:Envelope/soap-env:Body/cwmp:GetParameterNames/NextLevel", NAMESPACES).text()));
  let parameterList = [];

  if (nextLevel) {
    for (let p of parameterNames) {
      if (p.startsWith(parameterPath) && p.length > parameterPath.length + 1) {
        let i = p.indexOf(".", parameterPath.length + 1);
        if (i === -1 || i === p.length - 1)
          parameterList.push(p);
      }
    }
  } else {
    for (let p of parameterNames) {
      if (p.startsWith(parameterPath))
        parameterList.push(p);
    }
  }

  let getParameterNamesResponseNode = xmlOut.root().childNodes()[1]
    .node("cwmp:GetParameterNamesResponse");
  let parameterListNode = getParameterNamesResponseNode.node("ParameterList");

  parameterListNode.attr({
    "soap-enc:arrayType": `cwmp:ParameterInfoStruct[${parameterList.length}]`
  });

  for (let p of parameterList) {
    let parameterInfoStructNode = parameterListNode.node("ParameterInfoStruct");
    parameterInfoStructNode.node("Name", p);
    parameterInfoStructNode.node("Writable", String(device[p][0]));
  }

  return callback(xmlOut);
}


function GetParameterValues(device, xmlIn, xmlOut, callback) {
  let parameterNames = xmlIn.find("/soap-env:Envelope/soap-env:Body/cwmp:GetParameterValues/ParameterNames/*", NAMESPACES);
  let parameterList = xmlOut.root().childNodes()[1].node("cwmp:GetParameterValuesResponse").node("ParameterList");

  parameterList.attr({
    "soap-enc:arrayType": "cwmp:ParameterValueStruct[" + parameterNames.length + "]"
  });

  for (let p of parameterNames) {
    let name = p.text();
    let value = device[name][1];
    let type = device[name][2];
    let valueStruct = parameterList.node("ParameterValueStruct");
    valueStruct.node("Name", name);
    valueStruct.node("Value", device[name][1]).attr({
      "xsi:type": type
    });
  }

  return callback(xmlOut);
}


function SetParameterValues(device, xmlIn, xmlOut, callback) {
  let parameterValues = xmlIn.find("/soap-env:Envelope/soap-env:Body/cwmp:SetParameterValues/ParameterList/*", NAMESPACES);

  for (let p of parameterValues) {
    let name = p.get("Name").text();
    let value = p.get("Value");
    device[name][1] = value.text();
    device[name][2] = value.attr("type").value();
  }

  let responseNode = xmlOut.root().childNodes()[1]
    .node("cwmp:SetParameterValuesResponse");
  responseNode.node("Status", "0");
  return callback(xmlOut);
}


function AddObject(device, xmlIn, xmlOut, callback) {
  let objectName = xmlIn.get("/soap-env:Envelope/soap-env:Body/cwmp:AddObject/ObjectName", NAMESPACES).text();
  let parameters = [];
  let instances = {};
  let instanceNumber = 1;

  while (device[`${objectName}${instanceNumber}.`])
    instanceNumber += 1;

  for (let p of getSortedPaths(device)) {
    if (p.startsWith(objectName) && p.length > objectName.length) {
      let n = `${objectName}${instanceNumber}${p.slice(p.indexOf(".", objectName.length))}`;
      if (!device[n])
        device[n] = [device[p][0], "", device[p][2]];
    }
  }

  let responseNode = xmlOut.root().childNodes()[1].node("cwmp:AddObjectResponse");
  responseNode.node("InstanceNumber", String(instanceNumber));
  responseNode.node("Status", "0");
  delete device._sortedPaths;
  return callback(xmlOut);
}


function DeleteObject(device, xmlIn, xmlOut, callback) {
  let objectName = xmlIn.get("/soap-env:Envelope/soap-env:Body/cwmp:DeleteObject/ObjectName", NAMESPACES).text();

  for (let p in device) {
    if (p.startsWith(objectName))
      delete device[p];
  }

  let responseNode = xmlOut.root().childNodes()[1].node("cwmp:DeleteObjectResponse");
  responseNode.node("Status", "0");
  delete device._sortedPaths;
  return callback(xmlOut);
}


exports.inform = inform;
exports.GetParameterNames = GetParameterNames;
exports.GetParameterValues = GetParameterValues;
exports.SetParameterValues = SetParameterValues;
exports.AddObject = AddObject;
exports.DeleteObject = DeleteObject;
