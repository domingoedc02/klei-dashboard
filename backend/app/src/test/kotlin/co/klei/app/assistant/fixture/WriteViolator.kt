package co.klei.app.assistant.fixture

import co.klei.app.inquiry.InquiryService

/** Deliberate violation: the assistant package reaching a service that writes. Only the negative architecture test reads this package. */
class WriteViolator(val inquiries: InquiryService)
