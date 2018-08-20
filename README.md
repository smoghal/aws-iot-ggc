# Overview

The inspiration for this project came from AWS Greengrass Service and its ability to run Lambda function on edge devices.  The underpinning idea in this project is to leverage AWS Greengrass on Raspberry PI and interact with on-prem IoT devices/sensors that use an existing IoT orchrestration platform, i.e. NodeRed + Mosquitto MQTT and Home Assistance web/mobile app.  The on-prem sensor network is a combination of Z-Wave devices, Z-Wave controller and some Raspberry GPIO based sensors.  It is an isolated network that is not exposed on internet.  AWS Greengrass service perfectly fits into this isolated network and it allows for a two-way communication between AWS Cloud and on-prem IoT devices.

Project aims at accomplishing following goals.  These are further explained in the sections below.
- Invoke AWS Greengrass Core Lambda on the Edge
- Send on-prem sensor data to AWS IoT in AWS cloud
- Test AWS IoT Core Rule/Act features

Based on the outcome of this implementation, the longer term vision for this project is to migrate all IoT orchrestration logic to AWS IoT Core Rules in cloud.  This will eliminate the need of having any on-prem IoT orchrestration engine and will facilitate in securely storing data in the AWS cloud.


### AWS Greengrass Core Lambda on the Edge

Certain IoT devices, i.e. Ring products or Chamberlane Garage Openers, do not provide public API's to interface with the hardware (PIR and Video feeds).  One must interact with Ring partner services to gain access to device events; these partners include Samsung SmartHub, IFTT, Stringify.  So the goal is to leverage a Ring partner service that invokes AWS API Gateway API(s) to call Lambda function(s) in AWS Cloud.  These lambda function(s) interact with AWS Greengrass Shadow device service in cloud.  AWS Greengrass platform takes the shadow device updates and applies those updates to the actual IoT devices on-prem.  Using the similar approach, AWS Greengrass on the cloud invokes Lambda function on the edge.  The edge lambda then trigger an action on-prem using any IoT orchrestration engine to interact with the actual device.

### Send device data to AWS IoT Core

IoT devices and sensors on-prem need the ability to send data to AWS IoT cloud.  This will allow the AWS IoT platform to capture sensor data and push it to either AWS IoT Analytics service for analysis or to S3 for storage.

### AWS IoT Core Rule

AWS IoT Rules are essentially the orchrestration engine that acts on device / sensor events.  Rules can be used to trigger action in the cloud on AWS Greengrass shadow devices; these events are eventually pushed to on-prem devices to act on.


# Architecture

Following architecture diagram shows high-level pieces of this project:

1. Third party IoT service, i.e. Stringify, is used to capture signals from Ring and Chamberlane devices
2. Stringify invokes protected APIs hosted in AWS using API Gateway
3. API Gateway invokes Lambda functon that interact with AWS IoT Shadow Device service.  Both the Ring and Chamberlaine devices are represented as a shadow device in AWS IoT Core on the cloud.
4. When Lambda function on AWS Cloud interacts with shadow device service, the services pushes device updates to AWS Greengrass Core (GGC) running on-prem on a Raspberry PI (RPi)
5. GGC on RPi runs several "long running" Lambda functions.  GGC Lambda has the ability to run indefinitely.
6. The "long running" lambda function subscribe and publish to topics hosted on an on-prem MQTT server (running in Docker container on a Synology DSM).  In specific, to push PIR events from Ring devices to on-prem MQTT server, GGC long running lambda functions receives the Ring data from AWS Cloud via GGC platform and it publish to on-prem MQTT topic.
7. The on-prem device orchrestration engine, which runs NodeRed server, capture events from the Z-Wave network and pushes these event to the on-prem MQTT server topics.  Similarly, the NodeMCU GIO unit also sends GPIO device interactions to the MQTT messaging hub topics.
8. The orchrestration engine also subscribes to various MQTT topics.  When an event arrives on a topic that orchrestration is subscribed to, it decides what to do with the event by triggering actions on devices.  For example, GGC long running lambda functions publishes PIR events to specific MQTT topic that orchrestration engine is subscribed to.  When the PIR event arrives on the topic, orchrestration engine triggers interaction with Z-Wave switches.
9. In order to visually see the status of all the various Z-Wave and GPIO sensors, an open source application called "Home Assistant" is used.  It runs in a docker container on Synology DSM.  This server-side app (which has a mobile front-end) subscribes and publishes to MQTT topics.


![architecture][arch-v3]

# Deployment

This section covers the high-level deployment steps necessary to configure AWS IoT components, i.e.

- Create AWS Greengrass Group
- Setup AWS Greengrass Core on Raspberry Pi
- Create AWS Greengrass Things and Subscriptions
- Publisher Lambda Functions
- Greengrass Lambda Functions
- API Gateway

## Create AWS Greengrass Group

- Go into `IoT Core` service console
- Click `Greengass` > `Group` from the left menu
- Create `Create Group` button
- Name your group, e.g. `HomeGroup`
- Click `Use easy creation` button
- Finish creating the group

Once the group is created, download the `greengrass-linux-armv7*tar.gz` + `*-setup.tar.gz`.  This will be used in the next section to setup AWS Greengrass on Raspberry Pi device

## Setup AWS Greengrass Core (GGC) on Raspberry Pi

Follow the developer guide to [configure RPi][aws-iot-rpi-setup] device.  Steps are explained at a highlevel below:

- Fix Raspbian Stretch [cgroup kernel][fix-rpi-kernel] module
- Copy the two compressed files to RPi using SSH.
- Extract `greengrass-linux*tar.gz` into `/` folder as `root`.  It creates a subfolder called `/greengrass`, which will contain the Greengrass Core binaries.
- Extract `*setup.tar.gz` into `/greengrass` folder.  Make sure to backup the original `/greengrass/conf/config.json` file first.
- Download the root ca into `/greengrass/cert` folder:
  ```sh
  sudo wget -O root.ca.pem http://www.symantec.com/content/en/us/enterprise/verisign/roots/VeriSign-Class%203-Public-Primary-Certification-Authority-G5.pem
  ```

Once the device is configured, start GGC using the following command:
```sh
ssh -l pi <your_pi_IP_address>
cd /greengrass
sudo ./start_ggc.sh
```

Note down GGC log files on the RPi device.  These log files will contain information about the runtime, and edge lambda execution outputs/errors.

- GGC system log `/greengrass/ggc/var/log/system`
- Edge Lambda console.log statements go in
`/greengrass/ggc/var/log/user/<aws region>/<aws account>/<lambda name>.log`
- Edge Lambda crashes on GGC, check `/greengrass/ggc/var/log/crash.log`

## Create AWS Greengrass Things and Subscriptions

Log into your AWS account and locate `Greengrass` service. Navigate to the `Greengrass` console.

### Thing

- From the left-hand-side menu, click `Greengrass` > `Group`.  Select the group created in previous section
- Click on `Devices` under the group you selected.
- Click `Add Device` button to add thing created above
- Click `Create New Device` button
- Give device a unique name, i.e. `RingDoorBell` and click `Next`
- Click on the `Use Defaults` button
- On the next screen, click `Download these resources as a tar.gz` file.  These certificates are important and should be used when interacting with device from Lambda (more to come on this later)
- Click `Finish` to finish creating the new Greengrass device.

Repeat the above steps and create another device called `RingPatioCam`.  Download the certificates when prompted.

### Subscriptions

Next in order for the Device Shadow service to push events to AWS Greengrass, a set of subscriptions must be created:

- From the left-hand-side menu, click `Greengrass` > `Group`.  Select the group created in previous section
- Click on `Subscriptions`.  Define the following subscriptions for `RingDoorBell` thing:

  - source=RingDoorBell, target=Local Shadow Service, topic=$aws/things/RingDoorBell/shadow/update
  - source=Local Shadow Service, target=RingDoorBell, topic= $aws/things/RingDoorBell/shadow/update/delta
  - source=Local Shadow Service, target=RingDoorBell, topic=$aws/things/RingDoorBell/shadow/update/accepted
  - source=Local Shadow Service, target=RingDoorBell, topic=$aws/things/RingDoorBell/shadow/update/rejected

- Define following subscriptions for `RingPatioCam` thing:
  - source=RingPatioCam, target=Local Shadow Service, topic=$aws/things/RingPatioCam/shadow/update
  - source=Local Shadow Service, target=RingPatioCam, topic=$aws/things/RingPatioCam/shadow/update/delta
  - source=Local Shadow Service, target=RingPatioCam, topic=$aws/things/RingPatioCam/shadow/update/accepted
  - source=Local Shadow Service, target=RingPatioCam, topic=$aws/things/RingPatioCam/shadow/update/rejected

## Publisher Lambda Functions

There are two [Publisher Lambda][publisher-lambdas], `ring-doorbell-publisher` and `ring-patio-cam-publisher`.  These lambda functions receive the payload from API Gateway invocation and invoke AWS IoT Core using [Javascript SDK][aws-iot-sdk].  In specific, these lambda functions invoke the `thingShadow` API to interact with shadow device service.  The lambda functions update the showdow device with motion data (when the motion is detected and when the motion has settled).

These function depend on device certificates that were created in the previous steps.  Ensure that `cert` folder exists in the same directory as `index.js` file.  The cert folder must contain the public, private and root certificate.  For example:

The `ring-doorbell-publisher` cert folder structure should look like this:
- ring-doorbell-publisher/cert/RingPatioCam.private.key
- ring-doorbell-publisher/cert/RingPatioCam.cert.pem
- ring-doorbell-publisher/cert/root-CA.crt

The `ring-patio-cam-publisher` cert folder structure should look like this:
- ring-patio-cam-publisher/cert/RingPatioCam.private.key
- ring-patio-cam-publisher/cert/RingPatioCam.cert.pem
- ring-patio-cam-publisher/cert/root-CA.crt

## Greengrass Lambda Functions

There are two long-running [Subscriber Lambda][subscriber-lambdas], `ring-doorbell-subscriber` and `ring-patio-cam-subscriber`.  These lambda function again use the AWS IoT  [Javascript SDK][aws-iot-sdk].  The lambda functions receive the shadow device updates sent to `$aws/things/<thing>/shadow/update/delta` topic. The payload sent to the topic is PIR sensor data.  The functions then connect to the on-prem MQTT server running on Synology DSM and publish the PIR sensor event data.

In order to send on-prem sensor data to the AWS IoT Cloud, another long-running [Publisher Lambda][ggc-to-iot-publisher-lambda] subscribes to several MQTT topic on Synology DSM.

## API Gateway

API Gateway exposes two REST API's that can be invoked via HTTP POST method, `/ring/c1` and `/ring/d1`

In order to deploy these API into API Gateway, import the accompanying [swagger.yaml][api-swagger] using API Gateway console.

`/ring/c1`


[arch-v3]: Architecture_v3.0.png
[api-swagger]: src/api/swagger.yaml
[publisher-lambdas]: src/lambda
[subscriber-lambdas]: src/ggc-lambda
[ggc-to-iot-publisher-lambda]: src/ggc-lambda/sensors-event-publisher
[aws-iot-sdk]: https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-sdk-node.html
[aws-iot-rpi]: https://docs.aws.amazon.com/greengrass/latest/developerguide/module1.html
[aws-iot-rpi-setup]: https://docs.aws.amazon.com/greengrass/latest/developerguide/gg-device-start.html
[fix-rpi-kernel]: https://www.raspberrypi.org/forums/viewtopic.php?t=203128
