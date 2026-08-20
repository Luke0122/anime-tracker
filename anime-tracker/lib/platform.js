'use strict';

const os = require('os');

// Windows 11 22H2+（内部版本号 >= 22000）才支持 Mica / Acrylic 背景材质
function supportsMica(platform, release) {
  if (platform !== 'win32') return false;
  const m = String(release || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const build = Number(m[3]);
  return Number.isFinite(build) && build >= 22000;
}

function shouldUseMica() {
  return supportsMica(process.platform, os.release());
}

module.exports = { shouldUseMica, supportsMica };
