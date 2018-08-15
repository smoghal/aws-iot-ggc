# Overview

The inspiration for this project came from the release of AWS Greengrass core and ability to run Lambda function on edge devices.  The underpinning idea in this project is to leverage AWS Greengrass core on Raspberry PI and interact with on-prem IoT devices/sensors that use an existing IoT orchrestration platform, i.e. NodeRed + Mosquitto MQTT and Home Assistance web/mobile app.  The on-prem sensor network is a combination of Z-Wave devices, Z-Wave controller and some Raspberry GPIO based sensors.  It is an isolated network that is not exposed on internet.  AWS Greengrass service perfectly fits into this isolated network and it allows for a two-way communication between AWS Cloud and onprem IoT devices.

This project set out to accomplish three goals.  These are further explained in the sections below.
- Invoke AWS Greengrass Core Lambda on the Edge
- Ability to send onprem sensor data to AWS IoT in the cloud
- Test AWS IoT Core Rule/Act features

Based on the outcome of this implementation, the longer term vision for this project  is to migrate all IoT orchrestration logic to AWS IoT Core Rules in cloud.  This will eliminate the need to have any onprem orchrestration and securely store data in the AWS cloud.


### AWS Greengrass Core Lambda on the Edge

Certain IoT devices, i.e. Ring products or Chamberlane Garage Openers, do not provide public API's to interface with the hardware (PIR and Video feeds).  One must interact with Ring partner services to gain access to device events; these partners include Samsung SmartHub, IFTT, Stringify.  So the goal is to leverage a Ring partner service that invokes AWS API Gateway API(s) to call Lambda function(s)in AWS Cloud.  These lambda function(s) interact with AWS Greengrass Shadow device service.  AWS Greengrass platform takes the shadow device updates and applies those updates to the actual IoT devices onprem.  Using the similar approach, AWS Greengrass on the cloud invokes Lambda function on the edge.  The edge lambda then trigger an action onprem using any IoT orchrestration engine to interact with the actual device.

### Sending device data to AWS IoT Core

IoT devices and sensors onprem need the ability to send data to AWS IoT cloud.  This will allow the AWS IoT platform to capture sensor data and push it to either AWS IoT Analytics service for analysis or to S3 for storage.

### AWS IoT Core Rule

AWS IoT Rules are essentially the orchrestration brain behind device / sensor events.  Rules can be used to trigger action in the cloud on AWS Greengrass shadow devices; these events are eventually pushed to onprem devices to act on.


# Architecture

Following architecture diagram shows high-level pieces of this project.  At a high-level:

1. Third party IoT service, i.e. Stringify, is used to capture signals from Ring and Chamberlane devices
2. Stringify invokes protected APIs hosted in AWS using API Gateway
3. API Gateway invokes Lambda functon that interact with AWS IoT Shadow Device service.  Both the Ring and Chamberlaine devices are represented as a shadow device in AWS IoT Core on the cloud.
4. When Lambda function on AWS Cloud interacts with shadow device service, the services pushes device updates to AWS Greengrass Core (GGC) running onprem on a Raspberry PI (RPi)
5. AWS GGC on RPi runs several "long running" Lambda functions.  GGC Lambda has the ability to run indefinitely.
6. Long running lambda function subscribe and publish to topics hosted on an onprem MQTT server (running in Docker container on a Synology DSM).  In specific, to push PIR events from Ring devices, GGC long running lambda functions publish to MQTT topic on prem.
7. The onprem device orchrestration engine, that runs NodeRed server, capture events from the Z-Wave network and pushes these event to the onprem MQTT server topics.  Similarly, the NodeMCU GIO unit also sends GPIO device interactions to the MQTT messaging hub topics.
8. The orchrestration engine also subscribes to various MQTT topics.  When an event arrives on a topic that orchrestration is subscribed to, it decides what to do with the event by triggering actions on devices.  For example, GGC long running lambda functions publishes PIR events to specific MQTT topic that orchrestration engine is subscribed to.  When the PIR event arrives on the topic, orchrestration engine triggers interaction with Z-Wave switches.
9. In order to visually see the status of all the various Z-Wave and GPIO sensors, an open source application called "Home Assistant" is used.  It runs in a docker container on Synology DSM.  This server-side app (which has a mobile front-end) subscribes and publishes to MQTT topics.


![architecture][arch-v3]

# Deployment

This section covers the high-level deployment steps necessary to configure AWS components, i.e.

- AWS IoT Core
- Publisher Lambda Functions
- AWS Greengrass
- Greengrass Lambda Functions
- API Gateway

## AWS IoT Core

## Publisher Lambda Functions

## AWS Greengrass

## Greengrass Lambda Functions

## API Gateway

API Gateway exposes two REST API's that can be invoked via HTTP POST method, `/ring/c1` and `/ring/d1`

In order to deploy these API into API Gateway, import the accompanying [swagger.yaml][api-swagger] using API Gateway console.


[arch-v3]: Architecture_v3.0.png
[api-swagger]: src/api/swagger.yaml
