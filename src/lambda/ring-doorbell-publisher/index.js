const awsIot = require('aws-iot-device-sdk');
const os = require('os');
const util = require('util');

// ------------------------------------------------------------------
// Pre-flight info
const thingShadowName = 'RingDoorBell';
const lambda_name = 'ring-doorbell-publisher';
const myPlatform = util.format('%s-%s', os.platform(), os.release());
console.log(lambda_name+' lambda initialized on ' + myPlatform);

/**
 * Constructs the appropriate HTTP response.
 * @param {integer} statusCode - HTTP status code for the response.
 * @param {JSON} data - Result body to return in the response.
 */
const buildOutput = function(statusCode, data) {

    let _response = {
        statusCode: statusCode,
        headers: {
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
    };

    return _response;
};

/**
 * Routes the request to the appropriate logic based on the request resource and method.
 * @param {JSON} event - Request event.
 * @param {processRequest~requestCallback} cb - The callback that handles the response.
 */
const processRequest = function(event, callback) {

    console.log('processRequest() invoked');

    let _response = {};

    // Replace the values of '<YourUniqueClientIdentifier>' and '<YourCustomEndpoint>'
    // with a unique client identifier and custom host endpoint provided in AWS IoT cloud
    // NOTE: client identifiers must be unique within your AWS account; if a client attempts
    // to connect with a client identifier which is already in use, the existing
    // connection will be terminated.
    //
    var thingShadows = awsIot.thingShadow({
        keyPath: 'cert/RingDoorBell.private.key',
        certPath: 'cert/RingDoorBell.cert.pem',
        caPath: 'cert/root-CA.crt',
        clientId: lambda_name,
        host: '<hostname>.iot.us-east-1.amazonaws.com'
    });

    //
    // Client token value returned from thingShadows.update() operation
    //
    var clientTokenUpdate;

    thingShadows.on('connect', function() {
        console.log('processRequest thingShadows.on(connect) called');
        // After connecting to the AWS IoT platform, register interest in the
        // Thing Shadow.
        thingShadows.register(thingShadowName, {}, function() {
            // Once registration is complete, update the Thing Shadow named
            // 'RingDoorBell' with the latest device state and save the clientToken
            // so that we can correlate it with status or timeout events.

            console.log('thingShadows.register called');

            // Thing shadow state
            const motion = {
                'motion': true,
                'timestamp': new Date().getTime()
            };
            const shadowState = {"state":{"desired":{"motion": motion}}};

            console.log('thingShadows.register invoking thingShadows.update');
            clientTokenUpdate = thingShadows.update(thingShadowName, shadowState  );
            //
            // The update method returns a clientToken; if non-null, this value will
            // be sent in a 'status' event when the operation completes, allowing you
            // to know whether or not the update was successful.  If the update method
            // returns null, it's because another operation is currently in progress and
            // you'll need to wait until it completes (or times out) before updating the
            // shadow.
            //
            if (clientTokenUpdate === null) {
                // unregister interest & close MQTT connection
                thingShadows.unregister(thingShadowName);
                thingShadows.end(false, function(){
                    const err = {
                        'errorMessage': 'update shadow failed, operation still in progress'
                    };
                    console.log('error invoking shadow update: ', JSON.stringify(err));
                    _response = buildOutput(500, err);
                    console.log('error response sent: ', JSON.stringify(_response));
                    return callback(_response, null);
                });
            }

            // dump the token
            console.log('thingShadows.update done.  token: ', clientTokenUpdate);

            // wait for a few seconds and then unregister and disconnect thingShadows
            console.log('waiting few seconds before invoking thingShadows.unregister and thingShadows.end');
            setTimeout(
                function() {
                    // unregister interest & close MQTT connection
                    thingShadows.unregister(thingShadowName);
                    thingShadows.end(false, function(){
                        const data = {
                            'token': clientTokenUpdate,
                            'motion': motion
                        };
                        _response = buildOutput(200, data);
                        console.log('response sent: ', JSON.stringify(_response));
                        return callback(null, _response);
                    });
                }, 3000
            );

        });
    });
};

/**
 * Verifies user's authorization to execute requested action. If the request is
 * authorized, it is processed, otherwise a 401 unathorized result is returned
 * @param {JSON} event - Request event.
 * @param {respond~requestCallback} callback - The callback that handles the response.
 */
const respond = function(event, callback) {
    console.log('respond() called');
    let _authToken = '';

    if (typeof event.headers != "undefined" && event.headers != null) {
        if (event.headers.Auth) {
            console.log(['Header token post transformation:', 'Auth'].join(' '));
            _authToken = event.headers.Auth.replace(/\s/g,'');
        } else if (event.headers.auth) {
            console.log(['Header token post transformation:', 'auth'].join(' '));
            _authToken = event.headers.auth.replace(/\s/g,'');
        }
    }

    console.log('_authToken is "' + _authToken + '"');
    console.log('shared key is "' + process.env.SHARED_KEY + '"');

    // if auth token is empty OR
    // if auth token doesn't match shared key, return 401 unauth,
    // return 401 unauth
    if ( _authToken === '' || _authToken !== process.env.SHARED_KEY) {
        const tdata = {
            'error': 'Access denied. Incorrect token.'
        };
        const _errorResponse = buildOutput(401, tdata);
        console.log('response sent: ', JSON.stringify(_errorResponse));
        return callback(_errorResponse, null);
    }
    // otherwise, correct auth token is present, process incoming request
    else {
        console.log('invoking processRequest()');
        processRequest(event, callback);
    }
};

exports.handler = function(event, context, callback) {
    console.log(lambda_name+' lambda invoked on ' + myPlatform);
    console.log('received event:', JSON.stringify(event));
    console.log('received context:', JSON.stringify(context));

    respond(event, function(error, response) {
        if (error) {
            console.error(error);
            return callback(null, error);
        } else {
            return callback(null, response);
        }
    });

};
