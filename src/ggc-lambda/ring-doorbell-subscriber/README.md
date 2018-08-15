# Objective
This is an AWS Greengrass long-lived Lambda function.   It performs following functions:

1. register against the shadow device (or thing) named RingDoorBell
2. subscribes to 'status', 'delta', 'timeout' shadow device events
3. display uptime information in the log (for debugging puropses)

# Unimplemented
When 'delta' event is received, this lambda function should perform some action (for instance publish data to topic hosted on Synology MQTT)