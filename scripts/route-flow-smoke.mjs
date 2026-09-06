import fs from 'node:fs';

function addAndroidPermission(xml, permission) {
  const line = `    <uses-permission android:name="${permission}" />`;
  if (xml.includes(permission)) return xml;
  return xml.replace('<application', `${line}\n    <application`);
}
