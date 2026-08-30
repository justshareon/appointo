const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'AppBottomFooter.js');
let src = fs.readFileSync(file, 'utf8');

const replacements = [
  [
    `    groups.push({
      id: 'shopping',
      title: 'Shopping',
      icon: 'cart',
      children: [
        { title: 'Cart', route: 'Cart', icon: 'cart' },
        { title: 'My orders', route: 'UserOrders', icon: 'package-variant' },
      ],
    });`,
    `    groups.push({
      id: 'shopping',
      title: 'Shopping',
      icon: 'cart',
      color: '#4caf50',
      children: [
        { title: 'Cart', route: 'Cart', icon: 'cart', color: '#43a047' },
        { title: 'My orders', route: 'UserOrders', icon: 'package-variant', color: '#2e7d32' },
      ],
    });`,
  ],
  [
    `    groups.push({
      id: 'services',
      title: 'Services',
      icon: 'apps',
      children: serviceChildren,
    });`,
    `    groups.push({
      id: 'services',
      title: 'Services',
      icon: 'apps',
      color: '#9c27b0',
      children: serviceChildren,
    });`,
  ],
  [
    `    groups.push({
      id: 'vendor-shop',
      title: 'My shop',
      icon: 'store',
      children: shopChildren,
    });`,
    `    groups.push({
      id: 'vendor-shop',
      title: 'My shop',
      icon: 'store',
      color: '#ff9800',
      children: shopChildren,
    });`,
  ],
  [
    `  groups.push({
    id: 'tools',
    title: 'Tools',
    icon: 'cog',
    children: toolsChildren,
  });`,
    `  groups.push({
    id: 'tools',
    title: 'Tools',
    icon: 'cog',
    color: '#00bcd4',
    children: toolsChildren,
  });`,
  ],
  [
    `    {
      id: 'account-actions',
      title: 'Account',
      icon: 'account-circle',
      children,
    },`,
    `    {
      id: 'account-actions',
      title: 'Account',
      icon: 'account-circle',
      color: '#e91e63',
      children,
    },`,
  ],
  [
    `    {
      id: 'browse',
      title: 'Browse shops',
      icon: 'store',
      children: [
        { title: 'Nearby shops (QR dashboard)', route: 'UserHome', icon: 'home' },
        { title: 'Scan QR code', route: 'QRScanner', icon: 'qrcode-scan' },
      ],
    },
    {
      id: 'account',
      title: 'Account',
      icon: 'account',
      children: [
        { title: 'Login', route: 'Login', params: { mode: 'login' }, icon: 'login' },
        { title: 'Register', route: 'Login', params: { mode: 'register' }, icon: 'account-plus' },
      ],
    },`,
    `    {
      id: 'browse',
      title: 'Browse shops',
      icon: 'store',
      color: '#4caf50',
      children: [
        { title: 'Nearby shops (QR dashboard)', route: 'UserHome', icon: 'home', color: '#43a047' },
        { title: 'Scan QR code', route: 'QRScanner', icon: 'qrcode-scan', color: '#00897b' },
      ],
    },
    {
      id: 'account',
      title: 'Account',
      icon: 'account',
      color: '#3f51b5',
      children: [
        { title: 'Login', route: 'Login', params: { mode: 'login' }, icon: 'login', color: '#3949ab' },
        { title: 'Register', route: 'Login', params: { mode: 'register' }, icon: 'account-plus', color: '#5c6bc0' },
      ],
    },`,
  ],
];

let changed = 0;
for (const [from, to] of replacements) {
  if (src.includes(from)) {
    src = src.replace(from, to);
    changed += 1;
  }
}

fs.writeFileSync(file, src, 'utf8');
console.log(`Patched AppBottomFooter.js (${changed} replacements).`);
