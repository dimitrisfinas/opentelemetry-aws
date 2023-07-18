const { context: otelContext, propagation } = require("@opentelemetry/api");

// getter/setter used by the propagator to
// find the context value to use for propagation
// the default propagator in this solution is
// configured to look for the "x-amzn-trace-id"
// which is present in the object we pass to it
const headerGetter = {
  keys(carrier) {
    return Object.keys(carrier);
  },
  get(carrier, key) {
    return carrier[key];
  },
};

global.configureLambdaInstrumentation = (config) => {
  return {
    ...config,
    requestHook: (span, { event, context }) => {
      // adds an attribute to the span in the requestHook
      span.setAttribute("custom.req", "my request hook attribute");
      // renames the span to 'handler'
      span.updateName(`${context.functionName} handler`);
    },
    responseHook: (span, { err, res }) => {
      // captures the error message as an attribute when the function errors
      if (err instanceof Error) span.setAttribute("faas.error", err.message);
      if (res) {
        // adds the response from the function as a span event
        span.addEvent("Result", res);
      }
      // adds an attribute to the span in the responseHook
      span.setAttribute("custom.resp", "my response hook attr");
    },
    // disable propagation using AWS X-Ray headers
    disableAwsContextPropagation: true,
    // define how to extract context from the Lambda event
    eventContextExtractor: (event, context) => {
      // there are different ways to do this but here
      // we are using the HTTP headers format but setting
      // the trace ID to the appropriate context value from
      // the event object
      let carrier = {};
      // if the request comes from APIGW the HTTP headers
      // will be added to the headers property on the event
      if (event.headers) {
        carrier = event.headers || {};
      }
      // if the request is a Lambda.Invoke() from the SDK
      // the context will be in Custom property of the
      // ClientContext on the Lambda context object
      if (context.clientContext && context.clientContext.Custom) {
        carrier = context.clientContext.Custom;
      }
      // if the event is an SQS payload we need to get
      // the context from the AWSTraceHeader value
      // NOTE: this example assumes a batch of 1 message
      if (
        event.Records &&
        event.Records.length > 0 &&
        event.Records[0].attributes.AWSTraceHeader
      ) {
        carrier = {
          "x-amzn-trace-id": event.Records[0].attributes.AWSTraceHeader,
        };
      }

      // use the the propagation.extract() method and a custom
      // getter/setter to update the active context with the
      // values you values you defined above
      return propagation.extract(otelContext.active(), carrier, headerGetter);
    },
  };
};
