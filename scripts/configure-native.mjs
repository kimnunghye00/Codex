import fs from 'node:fs';

function addAndroidPermission(xml, permission) {
  const line = `    <uses-permission android:name="${permission}" />`;
  if (xml.includes(permission)) return xml;
  return xml.replace('<application', `${line}\n    <application`);
}

const androidManifest = 'android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(androidManifest)) {
  let xml = fs.readFileSync(androidManifest, 'utf8');
  [
    'android.permission.INTERNET',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
  ].forEach((permission) => { xml = addAndroidPermission(xml, permission); });
  fs.writeFileSync(androidManifest, xml);
  console.log('Configured Android permissions.');
}

const iosPlist = 'ios/App/App/Info.plist';
if (fs.existsSync(iosPlist)) {
  let plist = fs.readFileSync(iosPlist, 'utf8');
  const entries = [
    ['NSCameraUsageDescription', '사진과 영상통화를 위해 카메라를 사용합니다.'],
    ['NSMicrophoneUsageDescription', '음성 메시지와 통화를 위해 마이크를 사용합니다.'],
    ['NSPhotoLibraryUsageDescription', '앨범과 채팅에서 사진과 영상을 선택하기 위해 사진 보관함을 사용합니다.'],
    ['NSPhotoLibraryAddUsageDescription', 'ROUTE의 사진과 영상을 기기에 저장하기 위해 사용합니다.'],
    ['NSLocationWhenInUseUsageDescription', '지도와 발자취에서 현재 위치를 기록하고 공유하기 위해 사용합니다.'],
    ['NSLocationAlwaysAndWhenInUseUsageDescription', '사용자가 위치 공유를 켠 동안 발자취를 기록하기 위해 위치를 사용합니다.'],
  ];
  for (const [key, value] of entries) {
    if (plist.includes(`<key>${key}</key>`)) continue;
    plist = plist.replace('</dict>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`);
  }
  if (!plist.includes('<key>UIBackgroundModes</key>')) {
    plist = plist.replace('</dict>', '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t\t<string>audio</string>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>');
  }
  fs.writeFileSync(iosPlist, plist);
  console.log('Configured iOS usage descriptions and background modes.');
}

if (!fs.existsSync(androidManifest) && !fs.existsSync(iosPlist)) {
  console.log('Native projects are not present yet. Run npx cap add android and/or npx cap add ios first.');
}
