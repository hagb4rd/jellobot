const irc = require('irc');
const chalk = require('chalk');
const { maybeClearCache } = require('./utils/requireCache');

chalk.enabled = true;

const {readAndProcessConfig} = require('./utils/getConfig');
const plugins = require('./plugins/plugins.js');

const logBotPrefix = chalk.black.bgYellow('BOT');

let config = readAndProcessConfig();

const client = new irc.Client(config.server, config.nick, config.ircClientConfig);

function updateConfig() {
  const newConfig = readAndProcessConfig();
  if (!config) {
    config = newConfig;
    return;
  }

  // Cache these before we update the 'config' variable
  const oldChan = config.channels;
  const newChan = newConfig.channels;

  // Replace the config, which is passed around
  config = newConfig;

  // join channels
  for (const chan of newChan) {
    if (!oldChan.find(x => x.name === chan.name)) {
      client.join(chan.name);
    }
  }
  for (const chan of oldChan) {
    if (!newChan.find(x => x.name === chan.name)) {
      client.part(chan.name);
    }
  }
}

setInterval(updateConfig, 3000);

// mutable list of recent messages per channel
// newest messages first
const logs = {};

let lastProcessMessageFail = 0;

client.addListener('message', (from, to, message) => {
  if (from === config.nick) return;

  maybeClearCache(/processMessage/);

  let messageObj;
  try {
    // eslint-disable-next-line global-require
    const processMessage = require('./processMessage');
    messageObj = processMessage(client, config, logs, from, to, message);
  } catch (e) {
    const isRoom = /^#/.test(to);
    if (Date.now() > lastProcessMessageFail + (1000 * 60 * 60)) {
      lastProcessMessageFail = Date.now();
      client.say(isRoom ? to : from, `Internal error while processing the message`);
    }
    return;
  }

  plugins.run(messageObj);
});

client.addListener('error', (message) => {
  console.error(`${chalk.red('IRC Error')}:`, message);
});

const connectStartTime = Date.now();
let connectFinishTime;
client.addListener('registered', () => {
  connectFinishTime = Date.now();
  const diff = connectFinishTime - connectStartTime;
  console.log(`${logBotPrefix}: connected to ${config.server} as ${config.nick}.`);
  console.log(`${logBotPrefix}: took ${diff}ms to connect.`);

  if (config.password) {
    client.say('nickserv', `IDENTIFY ${config.userName} ${config.password}`);
    setTimeout(() => {
      config.channels
        .filter(x => x.requiresAuth)
        .forEach((c) => {
          client.join(c.name);
        });
    }, 1000);
  }
});
console.log(`${logBotPrefix}: Connecting to ${config.server} as ${config.nick}`);

const receivedNickListsForChannelEver = {};
client.addListener('names', (channel, nicks) => {
  if (receivedNickListsForChannelEver[channel]) {
    return;
  }
  receivedNickListsForChannelEver[channel] = true;
  const diffFromConnect = Date.now() - connectFinishTime;
  console.log(`${logBotPrefix}: connected to ${channel} which has ${Object.keys(nicks).length} users. Took ${diffFromConnect}ms since register.`);
});

if (config.verbose) {
  console.log(`${logBotPrefix}: ${chalk.yellow(`Running in verbose mode.`)}`);
}
