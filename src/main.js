class ICSParser {
    /**
     * @param {string} icsCalendarRaw
     * @returns {ICSCalendar}
     */
    static parseCalendar(icsCalendarRaw) {
        const calendar = new ICSCalendar();

        let eventParser = null;

        for (const tokenRaw of splitLines(icsCalendarRaw)) {
            const token = ICSParser.parseToken(tokenRaw);

            switch (token.key) {
                case TOKEN_KEY.BEGIN: {
                    switch (token.value) {
                        case TOKEN_VALUE.VEVENT:
                            eventParser = new ICSEventParser();
                            break;
                    }

                    break;
                }
                case TOKEN_KEY.END: {
                    switch (token.value) {
                        case TOKEN_VALUE.VEVENT:
                            calendar.events.push(eventParser.event);
                            eventParser = null;
                            break;
                    }

                    break;
                }
                default: {
                    if (eventParser) {
                        eventParser.applyToken(token);
                    }
                }
            }
        }

        return calendar;
    }

    /**
     * @param {string} tokenRaw
     * @returns {ICSToken}
     */
    static parseToken(tokenRaw) {
        const token = new ICSToken();
        const splitIndex = tokenRaw.indexOf(':');

        token.key = tokenRaw.slice(0, splitIndex);
        token.value = tokenRaw.slice(splitIndex + 1);

        if (token.key.includes(';')) {
            let [key, ...properties] = token.key.split(';');

            token.key = key;

            for (const prop of properties) {
                const [key, value] = prop.split('=');
                token.properties.set(key, value);
            }
        }

        return token;
    }
}

class ICSEventParser {
    event = new ICSEvent();

    parsers = {
        [TOKEN_KEY.UID]: ICSEventParser.parseUID,
        [TOKEN_KEY.SUMMARY]: ICSEventParser.parseSummary,
        [TOKEN_KEY.DESCRIPTION]: ICSEventParser.parseDescriptions,
        [TOKEN_KEY.URL]: ICSEventParser.parseUrl,
        [TOKEN_KEY.LOCATION]: ICSEventParser.parseLocation,
        [TOKEN_KEY.DTSTART]: ICSEventParser.parseDTStart,
    };

    /**
     * @param {ICSToken} token
     */
    applyToken(token) {
        const parser = this.parsers[token.key];

        if (parser) {
            parser.call(this, token);
        }
    }

    /**
     * @param {ICSToken} token
     */
    static parseUID(token) {
        this.event.uid = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    static parseSummary(token) {
        this.event.summary = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    static parseDescriptions(token) {
        this.event.description = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    static parseUrl(token) {
        this.event.url = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    static parseLocation(token) {
        this.event.location = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    static parseDTStart(token) {
        this.event.dtStart = ICSDateTimeParser.parseToken(token);
    }
}

class ICSDateTimeParser {
    /**
     * @param {ICSToken} token
     * @returns {ICSDateTime}
     */
    static parseToken(token) {
        const dateTime = new ICSDateTime();

        dateTime.timezoneId = token.properties.get('TZID') || null;

        return dateTime;
    }
}

class ICSCalendar {
    /**
     * @type {ICSEvent[]}
     */
    events = [];
}

class ICSEvent {
    /**
     * @type {string}
     */
    uid = null;

    /**
     * @type {string}
     */
    summary = null;

    /**
     * @type {string}
     */
    description = null;

    /**
     * @type {string}
     */
    url = null;

    /**
     * @type {string}
     */
    location = null;

    /**
     * @type {ICSDateTime}
     */
    dtStart = null;
}

class ICSDateTime {
    /**
     * @type {string}
     */
    timezoneId;
}

class ICSToken {
    /**
     * @type {string}
     */
    key;

    /**
     * @type {string}
     */
    value;

    /**
     * @type {Map<string, string>}
     */
    properties = new Map();
}

/**
 * @param {string} raw
 * @returns {string}
 */
function splitLines(raw) {
    return raw
        .trim()
        .split(/\r?\n/)
        .reduce((acc, cur) => {
            if (cur.startsWith(' ')) {
                acc[acc.length - 1] += cur.slice(1);
            } else {
                acc.push(cur);
            }

            return acc;
        }, []);
}

const TOKEN_KEY = {
    BEGIN: 'BEGIN',
    END: 'END',
    UID: 'UID',
    SUMMARY: 'SUMMARY',
    DESCRIPTION: 'DESCRIPTION',
    URL: 'URL',
    LOCATION: 'LOCATION',
    DTSTART: 'DTSTART',
};

const TOKEN_VALUE = {
    VEVENT: 'VEVENT',
};

// Node.js debugging
if (typeof module !== 'undefined') {
    module.exports.ICSParser = ICSParser;
    module.exports.ICSCalendar = ICSCalendar;
    module.exports.ICSEvent = ICSEvent;
}
