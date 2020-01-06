const ggc_sdk = require('aws-greengrass-core-sdk');
const mqtt = require('mqtt');
const os = require('os');
const util = require('util');

// ------------------------------------------------------------------
// Pre-flight info
const lambda_name = 'sensors-event-publisher';
const myPlatform = util.format('%s-%s', os.platform(), os.release());
console.log(lambda_name+' lambda initialized on ' + myPlatform);

// ------------------------------------------------------------------
// Greengrass Core SDK setup
const iotClient = new ggc_sdk.IotData();
const ggcTopicPrefix = 'syno';
const publishToGGC = function(ggcTopic, ggcPayload) {
    const pubOpt = {
        topic: ggcTopic,
        payload: JSON.stringify(ggcPayload)
    };

    console.log('publishing to ggc iot: ', ggcPayload);
    iotClient.publish(pubOpt, publishToGGCCallback);
};
const publishToGGCCallback = function(err, data) {
    if (err) {
        console.log('unable to publish to ggc iot. error: ', err);
    }
    console.log('successfully published to ggc iot. result: ', data);
};

// ------------------------------------------------------------------
// Synology MQTT setup
const mqttHost = typeof process.env.HOSTNAME !== 'undefined' ? process.env.HOSTNAME : 'localhost';
const mqttUser = typeof process.env.USERNAME !== 'undefined' ? process.env.USERNAME : 'mqtt';
const mqttPassword = typeof process.env.PASSWORD !== 'undefined' ? process.env.PASSWORD : 'mqtt';
const mqttMotionTopics = [
    'frontyard/motion/status',
    'frontdoor/motion/status',
    'garage/motion/status',
    'patio/motion/status'
];

const mqttClientOptions = {
    username: mqttUser,
    password: mqttPassword
};
var mqttConnected = false;
console.log('connecting to mqtt broker. hostname: ' +  mqttHost + ' user: ' + mqttUser + ' password: ****');
const client  = mqtt.connect('mqtt://'+mqttHost, mqttClientOptions);
client.on('connect', function () {
    console.log('connected to mqtt broker on ', mqttHost);
    mqttConnected = true;

    // subscribe to all topics
    for (let i = 0; i<mqttMotionTopics.length; i++){
        client.subscribe(mqttMotionTopics[i]);
    }
});
client.on('end', function () {
    console.log('mqtt client connection ended');
    mqttConnected = false;
});
client.on('error', function () {
    console.log('mqtt client connection error');
    mqttConnected = false;
});
client.on('message', function(topic, message) {
    if (!mqttConnected) {
        console.log('mqtt client is not connected! potential for disaster ahead: ', mqttConnected);
    }

    const messageBuffer = Buffer.from(message);
    console.log('mqtt client received message on: ', topic);
    console.log('mqtt client message is: ', messageBuffer.toString());


    // iterate over topics and match
    try {
        for (let i = 0; i<mqttMotionTopics.length; i++) {
            if (topic === mqttMotionTopics[i]) {
                console.log('topic matched : ', mqttMotionTopics[i]);

                // constuct ggc topic to publish to.  for example, syno/motion/frontyard
                const location = mqttMotionTopics[i].substr(0, mqttMotionTopics[i].indexOf("/"));
                const type = 'motion';
                const ggcTopic = ggcTopicPrefix + '/' + type + '/' + location;

                // lets extract 'eventLocation' from matched topic
                const eventLocation = mqttMotionTopics[i].substring(0, mqttMotionTopics[i].indexOf("/"));

                // lets extract 'eventType' from matched topic
                const startIndex = mqttMotionTopics[i].indexOf("/") + 1;
                const endIndex = mqttMotionTopics[i].indexOf("/", startIndex);
                const eventType = mqttMotionTopics[i].substring(startIndex, endIndex);

                // construct ggc payload to send to ggc topic.
                let ggcPayload = JSON.parse(message);

                // delete the original motionDetected key and store its
                // value so we can add it later.  We basically want to
                // rename the attribute 'motionDetected' to 'value'
                const value = ggcPayload.motionDetected;
                delete ggcPayload.motionDetected;

                // Lets also add original syno topic to the payload for legacy
                // purpose.  This will form the 'event' field.
                ggcPayload.event = topic;

                // Now, lets add attributes extracted above to our outgoing payload.
                ggcPayload.type = eventType;
                ggcPayload.location = eventLocation;
                ggcPayload.value = value;

                // Also, we should add human readable date time stamp to the payload
                // this indicates when the event occured.  This will make the event
                // object complete and more consumable when running IoT analytics
                const eventTimestamp = new Date();
                ggcPayload.timestamp = eventTimestamp.toString();
                ggcPayload.rawTimestamp = eventTimestamp.getTime();

                // Finally, publish the payload to ggc iot
                publishToGGC(ggcTopic, ggcPayload);
            }
        }
    }
    catch(e) {
        console.log('unable to publish sensor data to ggc iot: ', e);
    }
});
// ------------------------------------------------------------------
// This is a lambda handler which does nothing.  This lambda is a
// long-lived lambda and executes indefinitely on the edge on ggc
// raspberry pi device
exports.handler = function handler(event, context) {
    console.log(lambda_name+' lambda invoked on ' + myPlatform);
    console.log('received event: ', JSON.stringify(event));
    console.log('received context: ', JSON.stringify(context));
};
