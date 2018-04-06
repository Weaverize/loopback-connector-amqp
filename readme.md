# loopback-connector-amqp
Loopback connector that forwards every API call to an AMQP server and receives the responses to answer the original API call.

## Features
This connector forwards the call on static, instance method and change-stream request.
Everything is done using native AMQP functions such as reply_to and correlation_id.
See bellow the [topics](#Topics) used to transmit the requests and listen to model's change.

## Install
Just run npm
```
npm install --save loopback-connector-amqp
```

## Settings
Connectors settings through datasources.json:
```json
"sourcename": {
    "name": "sourcename",
    "connector": "amqp",
    "host": "127.0.0.1",
    "port": "5672",
    "login": "user",
    "password": "password",
    "exchange": "loopback",
    "binding" : "loopback"
}
```
- `name` is the sourcename of the datasource, use this name in the `model-config.json` file.
- `connector` should be `"amqp"` as the node module is called `loopback-connector-amqp`
- `host` (default: `127.0.0.1`) and `port` (default: `5672`) of your AMQP server
- `login` and `password` to connect to your AMQP server (default is empty)
- `exchange` name of the AMQP exchange to use (default: `loopback`). If the exchange doesn't exist, it will be created.
- `binding` name of the binding prefix to use to create the [topics](#topics).

## Topics
The request are sent on the AMQP exchange using the following topic format:
```
<binding>.request.<model>.<id|static>.<method>
```
where
- `<binding>` is the name of the binding used in the [settings](#Settings)
- `request` is hard coded for homogeneity with project `loopback-amqp-backend`
- `<model>` is the name of the model concerned by the request
- `<id>` or `"static"` to specify a specific instance of the model or a static method.
- `<method>` name of the method called (also works with remote methods)

## Request Handler
A specific request handler has been build to process the request and respond to them using loopback: https://github.com/Weaverize/loopback-amqp-backend

# Credit
Copyright (c) 2018, [Weaverize SAS](http://www.weaverize.com). All rights reserved. Contact: <dev@weaverize.com>.