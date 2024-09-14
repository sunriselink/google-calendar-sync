const CONFIG = {
    checkInterval: 10,
    startDate: '2024-09-01',
    calendars: [
        {
            name: 'Target calendar name',
            icsUrl: 'iCal URL',
        },
    ],
};

function install() {
    TriggerUtils.deleteTriggers();
    TriggerUtils.createStartSyncTrigger();

    startSync();
}

function uninstall() {
    TriggerUtils.deleteTriggers();
}

function startSync() {
    if (Mutex.isLocked()) {
        Logger.log('Another iteration is currently running! Exiting...');
        return;
    }

    Mutex.lock();

    for (const sourceCalendar of CONFIG.calendars) {
        Logger.log(`Fetching calendar "${sourceCalendar.name}" ...`);

        const calendar = CalendarUtils.fetchCalendar(sourceCalendar.name, sourceCalendar.icsUrl);

        Logger.log(`Total events: ${calendar.events.length}`);
    }
}

class TriggerUtils {
    static createStartSyncTrigger() {
        ScriptApp.newTrigger(startSync.name).timeBased().everyMinutes(CONFIG.checkInterval).create();
    }

    static deleteTriggers() {
        const allTriggers = [startSync].map(x => x.name);
        const projectTriggers = ScriptApp.getProjectTriggers();

        for (const trigger of projectTriggers) {
            if (allTriggers.includes(trigger.getHandlerFunction())) {
                ScriptApp.deleteTrigger(trigger);
            }
        }
    }
}

class Mutex {
    static lock() {
        PropertiesService.getUserProperties().setProperty('LAST_RUN', `${Date.now()}`);
    }

    static isLocked() {
        const lastRun = Number(PropertiesService.getUserProperties().getProperty('LAST_RUN') || 0);
        return lastRun > 0 && lastRun < 360000;
    }

    static unlock() {
        PropertiesService.getUserProperties().setProperty('LAST_RUN', '0');
    }
}

class CalendarUtils {
    /**
     * @param {string} name
     * @param {string} url
     * @returns {ICSCalendar}
     */
    static fetchCalendar(name, url) {
        const response = UrlFetchApp.fetch(url);
        const icsContent = response.getContentText();

        return ICSCalendarParser.parseCalendar(name, icsContent);
    }
}

class ICSCalendarParser {
    /**
     * @param {string} name
     * @param {string} icsCalendarRaw
     * @returns {ICSCalendar}
     */
    static parseCalendar(name, icsCalendarRaw) {
        icsCalendarRaw = icsCalendarRaw.trim();

        if (!this.validate(icsCalendarRaw)) {
            throw new Error('Incorrect ICS data');
        }

        const calendar = new ICSCalendar(name);

        let eventParser = null;

        for (const tokenRaw of this.splitLines(icsCalendarRaw)) {
            const token = ICSCalendarParser.parseToken(tokenRaw);

            switch (true) {
                case token.key === TOKEN_KEY.BEGIN && token.value === TOKEN_VALUE.VEVENT: {
                    eventParser = new ICSEventParser();
                    break;
                }
                case token.key === TOKEN_KEY.END && token.value === TOKEN_VALUE.VEVENT: {
                    calendar.events.push(eventParser.event);
                    eventParser = null;
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

    /**
     * @param {string} raw
     * @returns {string}
     */
    static splitLines(raw) {
        return raw.split(/\r?\n/).reduce((acc, cur) => {
            if (cur.startsWith(' ')) {
                acc[acc.length - 1] += cur.slice(1);
            } else {
                acc.push(cur);
            }

            return acc;
        }, []);
    }

    /**
     * @param {string} icsCalendarRaw
     * @returns {boolean}
     */
    static validate(icsCalendarRaw) {
        return /^BEGIN:VCALENDAR.*END:VCALENDAR$/s.test(icsCalendarRaw);
    }
}

class ICSEventParser {
    constructor() {
        this.event = new ICSEvent();

        this.parsers = {
            [TOKEN_KEY.UID]: this.parseUID,
            [TOKEN_KEY.SUMMARY]: this.parseSummary,
            [TOKEN_KEY.DESCRIPTION]: this.parseDescriptions,
            [TOKEN_KEY.URL]: this.parseUrl,
            [TOKEN_KEY.LOCATION]: this.parseLocation,
            [TOKEN_KEY.DTSTART]: this.parseDTStart,
            [TOKEN_KEY.DTEND]: this.parseDTEnd,
        };
    }

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
     * @param {string} name
     */
    constructor(name) {
        /** @type {string} */
        this.name = name;

        /** @type {ICSEvent[]} */
        this.events = [];
    }
}

class ICSEvent {
    constructor() {
        /** @type {string} */
        this.uid = null;

        /** @type {string} */
        this.summary = null;

        /** @type {string} */
        this.description = null;

        /** @type {string} */
        this.url = null;

        /** @type {string} */
        this.location = null;

        /** @type {ICSDateTime} */
        this.dtStart = null;

        /** @type {ICSDateTime} */
        this.dtEnd = null;
    }
}

class ICSDateTime {
    constructor() {
        /** @type {string} */
        this.timezoneId = null;

        /** @type {Date} */
        this.date = null;

        /** @type {boolean} */
        this.onlyDate = false;
    }
}

class ICSToken {
    constructor() {
        /** @type {string} */
        this.key;

        /** @type {string} */
        this.value;

        /** @type {Map<string, string>} */
        this.properties = new Map();
    }
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
        ICSCalendarParser,
        ICSCalendar,
        ICSEvent,
        ICSDateTime,
    };
}
