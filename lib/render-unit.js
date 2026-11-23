#!/usr/bin/env node
/**
 * render-unit.js — fill the ${NAME} placeholders of a services/ template.
 *
 * install.sh (scripts/install/services.sh) and openclaw-node-init both render
 * through here. Only the listed names are replaced, so systemd's own runtime
 * variables ($MAINPID) survive, and each value is inserted through a callback:
 * no character of it is special. Plist values are XML-escaped. In systemd
 * units and desktop entries a '%' is a specifier and is doubled; the units
 * quote ExecStart arguments and Environment assignments, but the same value
 * also lands in an unquoted WorkingDirectory=, where no escape works, so a
 * value carrying a quote, backslash or newline is refused instead.
 *
 * CLI: render-unit.js <plist|systemd|desktop> "<NAME NAME ...>" <template> —
 * values come from the environment (unset renders empty, as envsubst does),
 * the render goes to stdout.
 */
const fs = require('node:fs');

const specifierEscape = (kind, refused) => (v, name) => {
  if (refused.test(v)) throw new Error(`${name} contains a character a ${kind} cannot carry: ${JSON.stringify(v)}`);
  return v.replace(/%/g, '%%');
};

const ESCAPE = {
  plist: (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  systemd: specifierEscape('systemd unit', /["\\\n]/),
  desktop: specifierEscape('desktop entry', /["`$\\\n]/),
};

function renderUnit(text, vars, names, format) {
  const escape = ESCAPE[format];
  const unknown = new Set();
  const out = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name) => {
    if (!names.includes(name)) {
      unknown.add(placeholder);
      return placeholder;
    }
    return escape(vars[name] ?? '', name);
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
