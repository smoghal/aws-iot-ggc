/**
 * Documentation referneces:
 * https://docs.smartthings.com/en/latest/smartapp-developers-guide/preferences-and-settings.html
 * https://docs.smartthings.com/en/latest/tools-and-ide/logging.html
 * https://docs.smartthings.com/en/latest/smartapp-developers-guide/time-methods.html?highlight=current%20date
 * https://docs.smartthings.com/en/latest/ref-docs/smartapp-ref.html#smartapp-http-post
 */
definition(
  name: "Invoke Webhook When There's Motion",
  namespace: "smoghal",
  author: "Salman Moghal",
  description: "Invoke REST API when there is motion",
  category: "Convenience",
  iconUrl: "https://s3.amazonaws.com/smartapp-icons/Meta/intruder_motion-presence.png",
  iconX2Url: "https://s3.amazonaws.com/smartapp-icons/Meta/intruder_motion-presence@2x.png"
)

preferences {
	section("When there's movement...") {
		input "motion1", "capability.motionSensor", title: "Where?"
	}
	section("Invoke Webhook") {
    input "url1", "text", title: "URL", defaultValue: "https://<YOUR_APIG>.execute-api.us-east-1.amazonaws.com/v1"
	}
	section("Set Webhook API Key to...") {
    input "urlKey1", "text", title: "API Key"
	}
}

def installed() {
  log.debug "Installed with settings: ${settings}"
	subscribe(motion1, "motion.active", motionActiveHandler)
}

def updated() {
  log.debug "Updated with settings: ${settings}"
	unsubscribe()
	subscribe(motion1, "motion.active", motionActiveHandler)
}

def motionActiveHandler(evt) {
	log.info "$evt.value: $evt, $settings"

  // Don't continuously invoke Webhook URL
  def deltaSeconds = 10
  // convert to milliseconds
  def timeAgo = new Date(now() - (1000 * deltaSeconds))
  def recentEvents = motion1.eventsSince(timeAgo)
  log.debug "Found ${recentEvents?.size() ?: 0} events in the last $deltaSeconds seconds"
  def alreadyInvokedWebhook = recentEvents.count { it.value && it.value == "active" } > 1

  if (alreadyInvokedWebhook) {
    log.trace "Already invoked Webhook within the last $deltaSeconds seconds"
  } else {
    log.trace "$motion1 has moved, invoking webhook"
    log.trace "webhook url is $url1"
    log.trace "webhook api key is $urlKey1"

    def date = new Date()
    def sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss")
    def currentTimestamp = sdf.format(date)
    log.trace "current timestamp is $currentTimestamp"

    def params = [
      uri: url1,
      headers: [
        Auth: urlKey1
      ],
      body: [
        name: motion1.name,
        label: motion1.label,
        dateTime: currentTimestamp
      ]
    ]

    log.trace "params is $params"

    try {
      httpPostJson(params) { resp ->
        resp.headers.each {
          log.debug "${it.name} : ${it.value}"
        }
        log.debug "response contentType: ${resp.contentType}"
      }
    } catch (e) {
      log.debug "something went wrong: $e"
    }
  }
}
