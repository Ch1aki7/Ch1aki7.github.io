'use strict';

const fs = require('fs');
const path = require('path');

const pad = value => String(value).padStart(2, '0');
const now = new Date();
const date = [
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
].join(' ');
const id = date.replace(' ', '-').replaceAll(':', '');
const directory = path.resolve(__dirname, '../source/_talks');

fs.mkdirSync(directory, { recursive: true });

let output = path.join(directory, `${id}.md`);
let suffix = 2;
while (fs.existsSync(output)) output = path.join(directory, `${id}-${suffix++}.md`);

const template = `---
date: ${date}
pinned: false
tags: []
# images:
#   - example.webp
# music:
#   type: song
#   id: 28762386
# location:
# device:
---

在这里写下新的说说。
`;

fs.writeFileSync(output, template, 'utf8');
const assetDirectory = output.slice(0, -path.extname(output).length);
fs.mkdirSync(assetDirectory);
console.log(`已创建：${path.relative(path.resolve(__dirname, '..'), output)}`);
console.log(`资源目录：${path.relative(path.resolve(__dirname, '..'), assetDirectory)}`);
