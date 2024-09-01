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
        [TOKEN_KEY.UID]: this.parseUID,
        [TOKEN_KEY.SUMMARY]: this.parseSummary,
        [TOKEN_KEY.DESCRIPTION]: this.parseDescriptions,
        [TOKEN_KEY.URL]: this.parseUrl,
        [TOKEN_KEY.LOCATION]: this.parseLocation,
        [TOKEN_KEY.DTSTART]: this.parseDTStart,
        [TOKEN_KEY.DTEND]: this.parseDTEnd,
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
    parseUID(token) {
        this.event.uid = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    parseSummary(token) {
        this.event.summary = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    parseDescriptions(token) {
        this.event.description = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    parseUrl(token) {
        this.event.url = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    parseLocation(token) {
        this.event.location = token.value;
    }

    /**
     * @param {ICSToken} token
     */
    parseDTStart(token) {
        this.event.dtStart = ICSDateTimeParser.parseToken(token);
    }

    /**
     * @param {ICSToken} token
     */
    parseDTEnd(token) {
        this.event.dtEnd = ICSDateTimeParser.parseToken(token);
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

        /** @type {number[]} */
        let dateParams;
        let utc = false;

        if (token.properties.get('VALUE') === 'DATE') {
            const [_, year, month, day] = /^(\d{4})(\d{2})(\d{2})/.exec(token.value);
            dateParams = [parseInt(year), parseInt(month) - 1, parseInt(day)];
            dateTime.onlyDate = true;
        } else {
            const [_, year, month, day, hours, minutes, seconds, zeroTZ] =
                /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/.exec(token.value);

            dateParams = [
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hours),
                parseInt(minutes),
                parseInt(seconds),
            ];

            utc = !!zeroTZ;
        }

        if (utc) {
            dateTime.date = new Date(Date.UTC(...dateParams));
        } else {
            dateTime.date = new Date(...dateParams);
        }

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

    /**
     * @type {ICSDateTime}
     */
    dtEnd = null;
}

class ICSDateTime {
    /**
     * @type {string}
     */
    timezoneId = null;

    /**
     * @type {Date}
     */
    date = null;

    /**
     * @type {boolean}
     */
    onlyDate = false;
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
    DTEND: 'DTEND',
};

const TOKEN_VALUE = {
    VEVENT: 'VEVENT',
};

// Node.js debugging
if (typeof module !== 'undefined') {
    module.exports = {
        ICSParser,
        ICSCalendar,
        ICSEvent,
    };
}
