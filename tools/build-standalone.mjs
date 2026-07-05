#!/usr/bin/env node
// Build a single self-contained HTML file from the modular sources.
// The output runs from a file:// double-click or an email attachment,
// exactly like the original carbonator2_0 single-file versions.
//
// Usage:  node tools/build-standalone.mjs
// Output: dist/carbonator-standalone.html

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let html = read("index.html");

// Inline the stylesheet
html = html.replace(
  /[ \t]*<link rel="stylesheet" href="css\/app\.css" \/>/,
  () => `  <style>\n${read("css/app.css")}\n  </style>`
);

// Inline every local script, preserving order
html = html.replace(
  /[ \t]*<script src="([^"]+)"><\/script>/g,
  (_, src) => `  <script>\n${read(src)}\n  </script>`
);

if (/<link rel="stylesheet"|<script src=/.test(html)) {
  throw new Error("Unresolved external reference remains in output");
}

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", "carbonator-standalone.html");
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
