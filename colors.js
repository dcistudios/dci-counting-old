const chalk = require('chalk'); // This requires version 4 to work

const colors = {
    info: (text) => chalk.cyan('ℹ ') + text,
    success: (text) => chalk.green('✅ ') + chalk.bold(text),
    warn: (text) => chalk.yellow('⚠️ ') + text,
    error: (text) => chalk.red('❌ ') + chalk.bold(text),
    system: (text) => chalk.magenta.bold('🔄 ') + chalk.magenta(text)
};

module.exports = colors;
