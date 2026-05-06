import chalk from 'chalk';

const log = {
    info: (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.bold(msg)}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.green(msg)}`),
    warn: (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.yellow(msg)}`),
    error: (msg) => console.log(`${chalk.red('✖')} ${chalk.red.bold(msg)}`),
    
    // Custom branding
    brand: (msg) => console.log(chalk.bgMagenta.white.bold(` [MY-APP] `) + ` ${msg}`)
};

export default log;
