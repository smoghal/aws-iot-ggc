const awsIot = require('aws-iot-device-sdk');
const mqtt = require('mqtt');
const os = require('os');
const util = require('util');

// ------------------------------------------------------------------
// Pre-flight info
const lambda_name = 'ring-doorbell-subscriber';
const myPlatform = util.format('%s-%s', os.platform(), os.release());
console.log(lambda_name+' lambda initialized on ' + myPlatform);

// ------------------------------------------------------------------
// AWS IoT Core setup
const thingShadowName = 'RingDoorBell';
let lastMotionTimestamp = new Date().getTime(); // set to current time start when script starts
let lastMotionDetected = false; // set to false to indicate no motion detected when script starts

// NOTE: client identifiers must be unique within your AWS account; if a client attempts
// to connect with a client identifier which is already in use, the existing
// connection will be terminated.
var thingShadows = awsIot.thingShadow({
    keyPath: 'cert/RingDoorBell.private.key',
   certPath: 'cert/RingDoorBell.cert.pem',
     caPath: 'cert/root-CA.crt',
   clientId: lambda_name,
       host: 'a7x5e02nht4kx.iot.us-east-1.amazonaws.com'
});
thingShadows.on('connect', function() {
    console.log('thingShadows.on(connect) called');

    // After connecting to the AWS IoT platform, register interest in the
    // Thing Shadow.
    thingShadows.register(thingShadowName, {}, function() {
        console.log('thingShadows.register() called');

        // Once registration is complete, get the current state of the Thing
        // Shadow with the latest device state and save the clientToken
        // so that we can correlate it with status or timeout events.
        console.log('thingShadows.register invoking thingShadows.get');
        var clientTokenGet = thingShadows.get(thingShadowName);
        // The get method returns a clientToken; if non-null, this value will
        // be sent in a 'status' event when the operation completes, allowing you
        // to know whether or not the update was successful.  If the get method
        // returns null, it's because another operation is currently in progress and
        // you'll need to wait until it completes (or times out) before updating the
        // shadow.
        if (clientTokenGet === null) {
           console.log('get shadow failed, operation still in progress');
        }
        else {
            console.log('successfully registered and performed get. token: ', clientTokenGet);
        }
    });
});
thingShadows.on('status',
    function(thingName, stat, clientToken, stateObject) {
        // These events report the status of update(), get(), and delete()
        // calls.  The clientToken value associated with the event will have
        // the same value which was returned in an earlier call to get(),
        // update(), or delete().  Use status events to keep track of the
        // status of shadow operations.
        console.log('thingShadows.on(status) received '+stat+' on '+thingName+' with token '+clientToken+' : '+ JSON.stringify(stateObject));
    }
);
thingShadows.on('delta',
    function(thingName, stateObject) {
        console.log('thingShadows.on(delta) received delta on '+thingName+': '+ JSON.stringify(stateObject));

        // do something with the incoming shadow device event. e.g. turn lights on/off
        try {
            lastMotionDetected = stateObject.state.motion.motion;
            lastMotionTimestamp = stateObject.state.motion.timestamp;

            console.log('lastMotionDetected: ', lastMotionDetected);
            console.log('lastMotionTimestamp: ', lastMotionTimestamp);
            if (lastMotionDetected) {
                console.log('invoking pubhlishToSyno');
                publishToSyno(stateObject.state.motion);
            }
        }
        catch (e) {
            console.log('error while detecting motion', e);
        }
    }
);
thingShadows.on('timeout',
    function(thingName, clientToken) {
        // In the event that a shadow operation times out, you'll receive
        // one of these events.  The clientToken value associated with the
        // event will have the same value which was returned in an earlier
        // call to get(), update(), or delete().
        console.log('thingShadows.on(timeout) received timeout on '+thingName+' with token '+ clientToken);
    }
);

// ------------------------------------------------------------------
// Synology MQTT setup
const mqttHost = 'host';
const mqttUser = 'user';
const mqttPassword = 'password';
const mqttTopic = 'ringdoorbell/motion/on';

const mqttClientOptions = {
    username: mqttUser,
    password: mqttPassword
};
var mqttConnected = false;
console.log('connecting to mqtt broker');
const client  = mqtt.connect('mqtt://'+mqttHost, mqttClientOptions);
client.on('connect', function () {
    console.log('connected to mqtt broker on ', mqttHost);
    mqttConnected = true;
});
client.on('end', function () {
    console.log('mqtt client connection ended');
    mqttConnected = false;
});
client.on('error', function () {
    console.log('mqtt client connection error');
    mqttConnected = false;
});
// TODO - handle mqtt disconnect/reconnect

const publishToSyno = function(payload) {
    if (!mqttConnected) {
        console.log('unable to publish.  mqtt client is not connected.');
        return;
    }
    console.log('pushlishing to ' + mqttTopic + ' payload: ', JSON.stringify(payload));
    client.publish(mqttTopic, JSON.stringify(payload));
};

// ------------------------------------------------------------------
// Reset PIR shadow device motion state to false
const resetPIRState = function() {

    // if motion was detected
    if (lastMotionDetected) {
        // dump some debugging info
        showServerUptime();

        const currTimestamp = new Date().getTime();
        const timeDelta = Math.floor(( currTimestamp - lastMotionTimestamp ) / 1000 );

        console.log('lastMotionDetected: ', lastMotionDetected);
        console.log('lastMotionTimestamp: ', lastMotionTimestamp);
        console.log('timeDelta: ', timeDelta);

        // if motion was detected and at least 30 seconds lapsed since, then reset PIR shadow state
        if (timeDelta > 30) {
            console.log('resetting '+thingShadowName+' motion shadow state');
            // Thing shadow state
            const motion = {
                'motion': false,
                'timestamp': new Date().getTime()
            };
            var shadowState = {"state":{"desired":{"motion": motion}}};
            clientTokenUpdate = thingShadows.update(thingShadowName, shadowState  );
            if (clientTokenUpdate === null) {
                console.log('update shadow failed, operation still in progress');
            }
            else {
                console.log('successfully registered and performed update. token: ', clientTokenUpdate);
            }
        }
    }
};
// Format server uptime in human reable form
const formatTime = function(seconds) {
    function pad(s){
      return (s < 10 ? '0' : '') + s;
    }
    var hours = Math.floor(seconds / (60*60));
    var minutes = Math.floor(seconds % (60*60) / 60);
    var seconds2 = Math.floor(seconds % 60);

    return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds2);
};
// Dump server uptime
const showServerUptime = function() {
    const uptime = process.uptime();
    console.log('lambda uptime: ', formatTime(uptime));
};
// Scheduler that runs every 15 seconds
const runScheduler = function() {
    resetPIRState();
};
// Start the scheduler when script loads
setInterval(runScheduler, 15000);

// ------------------------------------------------------------------
// This is a lambda handler which does nothing.  This lambda is a
// long-lived lambda and executes indefinitely on the edge on ggc
// raspberry pi device
exports.handler = function handler(event, context) {
    console.log(lambda_name+' lambda invoked on ' + myPlatform);
    console.log('received event: ', JSON.stringify(event));
    console.log('received context: ', JSON.stringify(context));
};
