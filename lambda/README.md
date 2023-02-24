# OPENTELEMETRY FOR AWS LAMBDA SERVERLESS FUNCTIONS


## CONTENT

This is instructions to use OpenTelemetry in the context of AWS Lambda serverless Cloud Functions.


## PREREQUISITES

- create your function

- here we will use example of a nodeJS function


## ADD TRACING

- Follow instructions on this page https://aws-otel.github.io/docs/getting-started/lambda/lambda-js to add tracing layer to your function

  - Add layer
  ```arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-9-1:1```

  - Go to configuration/monitoring of your function and enable tracing
    - accept to add required permissions to your role to enable tracing

  - Go to environment variable of your function and add variable `AWS_LAMBDA_EXEC_WRAPPER` with value `/opt/otel-handler`

  - Test your function and see traces are available in monitoring AWS X-Ray


## CONFIGURE TRACING TO EXTERNAL BACKEND

- follow instructions on this page https://aws-otel.github.io/docs/getting-started/lambda to add external backend

  - add a collector config file to your project like `/opentelemetry/collector.yaml`

  - update you collector config file to add a new backend (here `otlp/lightstep`)
```
#collector.yaml in the any directory below your src root directory
receivers:
  otlp:
    protocols:
      grpc:
      http:

exporters:
  logging:
    loglevel: debug
  awsxray:
  # configuring otlp to Lightstep public satellites
  otlp/lightstep:
    endpoint: ingest.lightstep.com:443
    headers:
      "lightstep-access-token": "${LIGHTSTEP_ACCESS_TOKEN}"

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [logging, awsxray, otlp/lightstep]
```

  - the AWS Otel collector (ADOT) has a lot of limitations (as of v1.0.1 of 29/04/2022)
    - you can use only otlp receiver
    - you can't use any processor
    - you can use only awsxray, logging, or otlp exporters

  - you can see root code of this collector here: https://github.com/aws-observability/aws-otel-collector, even if many components seems available in collector, they didn't work in the official layer version I tested

  - Go to your function configuration environment variables and add 2 variables below:
    - `OPENTELEMETRY_COLLECTOR_CONFIG_FILE` with value `/var/task/*<path/<to>/<filename>*` (here it is `/var/task/opentelemetry/collector.yaml`)
    - `LIGHTSTEP_ACCESS_TOKEN` with your token value

  - Test your function and see traces are available in monitoring AWS X-Ray and Lightstep


## ADD SOME MANUAL INSTRUMENTATION

- Let's add some manual attributes to customize our instrumentation

- First, we will add attributes with environment variables. Add the one below:
  - `OTEL_SERVICE_NAME` with your service name as value. By default, AWS will name your service with its `<name>` (in previous version, it used to be `serverlessrepo-<name>-<id>`, so this was more useful)
  - `OTEL_RESOURCE_ATTRIBUTES` with `service.version=<your_version>`, you can also add here as many resource specific attributes as you want by putting key/values separated by comma
  - refer to https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/semantic_conventions/README.md for advices on semantic conventions for your attributes
  - it is recommended to test first and check that the attribute you want to put is not already attached with automatic instrumentation

- Second, we will add attributes and log events in the code of our function
  - update your `package.json` file to add dependency below (if not existing, you need to create one)
```
"dependencies": {
  "@opentelemetry/api": "^1.1.0"
}
```  

  - define a global const above your function code
```
const api = require('@opentelemetry/api');
```

  - use sample of code below to add attributes or log events
```
  // access the current span from active context
  let activeSpan = api.trace.getSpan(api.context.active());
  // add an attribute
  activeSpan.setAttribute('value1', event.key1);
  // log an event and include some structured data.
  activeSpan.addEvent('Received event:' + JSON.stringify(event, null, 2));    
```

  - TO TEST: you can also create a span to trace a specific function and no trace is auto instrumented for it
    - define a global const above your function code
```
const tracer = require('XXX');
```

    - add code below to create span
  ```
    // access the current span from active context
    let activeSpan = api.trace.getSpan(api.context.active());
    // check if it exists (sometimes, there is no span for this context)
    if (activeSpan === undefined) {
      // create a new span
      let activeSpan = tracer.startSpan('myFunction');
      // make it the active span

      // Set a boolean to understand this is manual instrumentation
      let manual_span = true;
    } else {
      let manual_span = false;
    }
    // add an attribute
    activeSpan.setAttribute('value2', event.key2);

    // don't forget to end it so that
    if (manual_span) { activeSpan.end(); };

  ```


## DISABLE AWS X-RAY

- you may want to send only traces to your own backend and so, disable sending them to AWS X-Ray

  - normally, you would just have to go to your OpenTelemetry collector config file and remove `awsxray`from your trace pipeline

  - after test, it seems this is not sufficient, as traces are still pushed to X-Ray, so the only solution we found to this was to change the permissions of the execution role to take one that don't include tracing (if you disable tracing, no trace will be sent at all)
    - if you find better than this, please tell me

  - by the way, I would also recommend removing `logging` from this pipeline or at least putting in comment the `loglevel: debug`


## TROUBLESHOOTING

- error `User: XXX is not authorized to perform: lambda:GetLayerVersion on resource: YYY because no resource-based policy allows the lambda:GetLayerVersion action`
    - check if your layer name is correct
    - be careful, for `x86_64`architecture, you should use `amd64` term (and for `arm64`, it is `arm64` ;-) )

- error  `undefined` when trying to get a span that don't exist
  => Even if auto-instrumented, some functions may not have any active span
  => Then, you will have to create your own ones if this is the case
  => After retrieving active span, test if not empty: use startSpan() if it is the case and don't forget to use span.end() at the end of your function

- error `XXX` when not having library the `package.json` file
  => Add required library in dependencies section of your package.json file
