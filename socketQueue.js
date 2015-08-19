var socketServer    = require('socketServer');
var argv            = require('optimist').argv;
var winston         = require('winston');
                      require('winston-logstash');
var fs              = require('fs');
var helpers         = require('helpers');
var logger          = false;
var fileTransport   = null;

// Available runtime parameters configuration
var validParams = require('./parameters.js').params;

// This one displays configuration help
String.prototype.repeat = function(num)  {
  return new Array( num + 1 ).join( this );
}

var c = {};

var readCfgParam = function(name, value) {
  if (!validParams.hasOwnProperty(name)) {
    return null;
  } else {
    if (validParams[name]['type'] == 's') {
      return value;
    } else if (validParams[name]['type'] == 'n') {
      return parseInt(value);мш
    } else {
      return value == true ? true : false;
    }
  }
}

// Loading command line parameters
for (var name in argv) {
  if (name == '_' || name.substring(0,1) == '$') continue;

  var val = readCfgParam(name, argv[name]);

  if (val !== null) {
    c[name] = val;
  } else {
    console.log("Configuration error: invalid parameter " + name + ". See node socketQueue.js --help to see available parameters\n");
    process.exit(0);
  }
}

// Read file config
if (c.c) {
  if (!fs.existsSync(c.c)) {
    console.log("Configuration file " + c.c + " does not exist!");
    process.exit(0);
  }

  var cfgData = JSON.parse(fs.readFileSync(c.c, 'utf8'));

  for (var name in cfgData) {
    var val = readCfgParam(name, cfgData[name]);

    if (val !== null) {
      c[name] = val;
    } else {
      console.log("Configuration file: invalid parameter " + name + ". See node socketQueue.js --help to see available parameters\n");
      process.exit(0);
    }
  }
}

// Applying defaults
for (var name in validParams) {
  if (validParams[name]['default'] && !c.hasOwnProperty(name)) {
    c[name] = validParams[name]['default'];
  }
}

global.c = c;
global.dd = dd;

// Display help screen
if (c.help) {
  console.log("\nSocketQueue is a socket queue (many-to-many-many-to-one connection demultiplexer) with extra toots (ISO8583 host emulator, IS08583 host load tests)");
  console.log("\nAvailable parameters:\n");
  for (var name in validParams) {
    var left = '--' + name;
    if (validParams[name]['sample']) left += '=' + validParams[name]['sample'];
    left += ':';

    console.log(left + ' '.repeat(50 - left.length) + validParams[name]['title']);
  }
  console.log("\nExample: node socketQueue.js --upstreamHost=10.1.15.146 --upstreamPort=2013 --listenPort=2014 --vv --logFile=log.txt\n");

  process.exit(0);
}

// Display json help
if (c.helpJson) {
  var i = 0; var cnt = Object.keys(validParams).length;
  console.log('{');
  for (var name in validParams) {
    var msg = '"' + name + '": ';
    if (validParams[name]['default']) {
      msg += validParams[name]['type'] == 's' ? '"' + validParams[name]['default'] + '"' : validParams[name]['default'];
    } else if (validParams[name]['type'] == 's') {
      msg += '""';
    } else if (validParams[name]['type'] == 'b') {
      msg += 'false'
    } else {
      msg += '';
    }
    console.log('    ' + msg + (i == cnt - 1 ? '' : ','));
    i++;
  }

  console.log('}');

  process.exit(0);
}

// Checking parameters
if (c.upstreamHost && (!c.upstreamPort || !c.listenPort)) {
  console.log("Usage socketQueue.js [options]");
  console.log("Run socketQueue.js --help to see help");

  process.exit(0);
} else if (c.testClients && !c.testTargetHost) {
  console.log("No test target host specified. Aborting");

  process.exit(0);
} else if (c.testClients && !c.testTargetPort) {
  console.log("No test target port specified. Aborting");

  process.exit(0);
} else if (c.logstashHost && !c.logstashPort) {
  console.log("No Logstash port specified. Aborting");

  process.exit(0);
}

// Setting up Winston debug
if (c.v) c.debugLevel = 'info';
if (c.vv) c.debugLevel = 'verbose';

if (c.debugLevel) {
  var customLevels = {
    common: 0,
    private: 1
  };

  var transports = [];
  var dateFunc = function() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).substr(-2) + '-' + ('0' + d.getDate()).substr(-2) + ' ' + ('0' + d.getHours()).substr(-2) + ':' + ('0' + d.getMinutes()).substr(-2) + ':' + ('0' + d.getSeconds()).substr(-2)}

  // Set up console logging
  if (!c.silent) {
    transports.push(new (winston.transports.Console)(
      {
        timestamp:  dateFunc,
        level:      c.debugLevel
      }));
  }

  winston.level = c.debugLevel;
  winston.showLevel = false;

  // Set up logging into file
  if (c.logFile) {
    fileTransport = new (winston.transports.File) (
      {
        filename:       c.logFile,
        json:           false,
        showLevel:      false,
        colorize:       false,
        timestamp:      dateFunc,
        level:          c.debugLevel
      });

    transports.push(fileTransport);
  }

  // Logstash
  if (c.logstashHost) {
    ls = new (winston.transports.Logstash)(
      {
        host: c.logstashHost,
        port: c.logstashPort,
        node_name: c.logstashNode
      });

    ls.on('error', function (error) {
      dd('Winston Logstash error: ' + error);
    });

    transports.push(ls);
  }

  logger = new (winston.Logger) ({
    transports: transports
  });

  logger.exitOnError = false;
}

// c.debugLevel output
function dd(msg, level)  {
  if (!logger) return;
  if (!msg) return;
  if (!level) level = 'info';

  msg = helpers.safeLog(msg);

  // Here goes a sort of hidden multiline message delimiter
  msg += "                         ";

  logger.log(level, msg);
}

dd('Important: starting...'.green);

// Start the upstream server
if (c.upstreamHost) {
  var upstreamServer = new socketServer.upstream(c);

  var serverSocket = new socketServer.clientSocket(upstreamServer, c).listen(c.listenPort);
  dd("Relay server is now running on port " + c.listenPort);

  if (c.listenHttpPort) {
    var serverHttp = new socketServer.clientHttpServer(upstreamServer, c).listen(c.listenHttpPort);
    dd("Relay HTTP server is now running on port " + c.listenHttpPort);
  }
} else {
  var upstreamServer  = null;
  var serverSocket    = null;
  var serverHttp      = null;
}

if (c.echoServerPort || c.testClients) var testSuite = require('testSuite');

// Start test server and perform tests
if (c.echoServerPort) {
  // Run local echo server
  var echoServer = new testSuite.echoServer(c, dd).listen(c.echoServerPort);

  dd("Echo server is now running on port " + c.echoServerPort + "\n");
}

// Run local clients
if (c.testClients) {
  setTimeout(function () {
    var testClients = [];
    for (var i = 1; i < c.testClients + 1; i++) {
      testClients.push(new testSuite.testClient(dd).start(c, i));
    }
  }, 1000);
}

// Pidfile
if (c.pidFile) {
  fs.writeFile(c.pidFile, process.pid, function (err) {
    if (err) dd(err);
  });
}

// Signals
process.on('SIGINT', function() {
  dd('Warning: got SIGINT.');
  gracefulQuit();
});

process.on('SIGTERM', function() {
  dd('Warning: got SIGTERM.');

  gracefulQuit();
});

process.on('SIGHUP', function() {
   dd('Warning: got SIGHUP.');

  if (upstreamServer.statServer) upstreamServer.statServer.reset();
  if (fileTransport) helpers.winstonRotate(fileTransport);
});

// On Exit
process.on('exit', function(code) {
  if (c.pidFile) {
    fs.writeFile(c.pidFile, '', function (err) {
      if (err) dd(err);
    });
  }
});

function gracefulQuit() {
  // If no upstream server running -- just quit
  if (!upstreamServer) {
    dd('Quitting...');
    process.exit(0);
  // If there is upstream server -- let it pick a proper moment then quit
  } else {
    if (serverSocket) serverSocket.deny();
    if (serverHttp) serverHttp.deny();

    upstreamServer.emit('terminate');
  }
}