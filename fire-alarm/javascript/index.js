"use strict";

// The program is using the Node.js built-in `fs` module
// to load the config.json and any other files needed
var fs = require("fs");

// The program is using the Node.js built-in `path` module to find
// the file path to needed files on disk
var path = require("path");

// Load configuration data from `config.json` file. Edit this file
// to change to correct values for your configuration
var config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"))
);

// Initialize the hardware devices
var temp = new (require("jsupm_grove").GroveTemp)(0),
    buzzer = new (require("jsupm_buzzer").Buzzer)(5),
    screen = new (require("jsupm_i2clcd").Jhd1313m1)(6, 0x3E, 0x62);

// The program handles events generated by the various connected
// hardware devices using the Node.js built-in `events` module
var events = new (require("events").EventEmitter)();

// Colors used for the RGB LED
var colors = { red: [255, 0, 0], white: [255, 255, 255] };

// The program is using the `superagent` module
// to make the remote calls to the data store
var request = require("superagent");

// The program is using the `twilio` module
// to make the remote calls to Twilio service
// to send SMS alerts
var twilio = require("twilio")(config.TWILIO_ACCT_SID,
                               config.TWILIO_AUTH_TOKEN);


// Sets the background color on the RGB LED
function color(string) {
  screen.setColor.apply(screen, colors[string] || colors.white);
}

// Displays a message on the RGB LED
function message(string, line) {
  // pad string to avoid display issues
  while (string.length < 16) { string += " "; }

  screen.setCursor(line || 0, 0);
  screen.write(string);
}

// Sound an audible alarm when a possible fire is detected
function buzz() {
  buzzer.setVolume(0.5);
  buzzer.playSound(2600, 0);
}

// Turn off the audible alarm
function stopBuzzing() {
  buzzer.stopSound();
  buzzer.stopSound(); // if called only once, buzzer doesn't completely stop
}

// Reset the alarm
function reset() {
  color("white");
  message("", 1);
  stopBuzzing();
}

// Send an SMS alert that a possible fire has been detected
function notifySMS() {
  if (!config.TWILIO_ACCT_SID || !config.TWILIO_AUTH_TOKEN) {
    return;
  }

  var opts = { to: config.NUMBER_TO_SEND_TO,
               from: config.TWILIO_OUTGOING_NUMBER,
               body: "fire alarm" };

  // send SMS
  twilio.sendMessage(opts, function(err, response) {
    if (err) { return console.error("err:", err); }
    console.log("SMS sent", response);
  });
}

// Display and then store record in the remote datastore
// of each time a fire alarm condition has been triggered
function notify() {
  console.log("fire alarm");

  notifySMS();

  if (!config.SERVER || !config.AUTH_TOKEN) {
    return;
  }

  // notify datastore of time alarm went off
  request
    .put(config.SERVER)
    .set("X-Auth-Token", config.AUTH_TOKEN)
    .send({ value: new Date().toISOString() })
    .end(function(err, res) {
      if (err) { return console.error("err:", err); }
      console.log("datastore notified");
    });
}

// Loops every 500ms to check if the ambient temperature
// has exceeded the threshold, indicating that a possible
// fire emergency exists
function monitorTemperature() {
  var prev = 0;

  setInterval(function() {
    var current = temp.value();

    message("temperature: " + current);

    // check if fire alarm should be triggered
    if (prev < config.ALARM_THRESHOLD && current >= config.ALARM_THRESHOLD) {
      events.emit("start-alarm");
    }

    if (prev >= config.ALARM_THRESHOLD && current < config.ALARM_THRESHOLD) {
      events.emit("stop-alarm");
    }

    prev = current;
  }, 500);
}

// Called to start the alarm when a possible fire
function alarm() {
  notify();

  var tick = true;

  color("red");
  message("fire detected!", 1);
  buzz();

  var interval = setInterval(function() {
    color(tick ? "white" : "red");
    if (tick) { stopBuzzing(); } else { buzz(); }
    tick = !tick;
  }, 250);

  events.once("stop-alarm", function() {
    clearInterval(interval);
    reset();
  });
}

// The main function makes sure the alarm buzzer and LCD
// are turned off, then starts checking the ambient temperature
// using the connected hardware.
// The custom event `start-alarm` is fired, if a possible
// fire emergency exists, which calls the `alarm()` function.
function main() {
  reset();
  monitorTemperature();
  events.on("start-alarm", alarm);
}

main();