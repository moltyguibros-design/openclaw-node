#!/usr/bin/env node
/**
 * render-unit.js — fill the ${NAME} placeholders of a services/ template.
 *
 * install.sh (scripts/install/services.sh) and openclaw-node-init both render
 * through here. Only the listed names are replaced, so systemd's own runtime
 * variables ($MAINPID) survive, and each value is inserted through a callback:
 * no character of it is special. Plist values are XML-escaped.
 *
 * CLI: render-unit.js <plist|systemd> "<NAME NAME ...>" <template> — values
 * come from the environment (unset renders empty, as envsubst does), the
 * render goes to stdout.
 */
const fs = require('node:fs');

const ESCAPE = {
  plist: (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  systemd: (v) => v,
};

function renderUnit(text, vars, names, format) {
  const escape = ESCAPE[format];
  const unknown = new Set();
  const out = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name) => {
    if (!names.includes(name)) {
      unknown.add(placeholder);
      return placeholder;
    }
    return escape(vars[name] ?? '');
  });
  if (unknown.size) throw new Error(`unrendered template variable(s): ${[...unknown].join(', ')}`);
  return out;
}

if (require.main === module) {
  const [format, names, template] = process.argv.slice(2);
  try {
    process.stdout.write(renderUnit(fs.readFileSync(template, 'utf8'), process.env, names.split(' '), format));
  } catch (err) {
    console.error(`${template}: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { renderUnit };
