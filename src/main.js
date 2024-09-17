const CONFIG = {
    checkInterval: 15,
    startDate: '2024-09-01',
    /**
     * @typedef {{ name: string, icsUrl: string }} CalendarConfig
     */
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

    for (const sourceCalendarConfig of CONFIG.calendars) {
        CalendarUtils.syncEvents(sourceCalendarConfig);
    }

    Mutex.unlock();
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
     * @param {CalendarConfig} calendarConfig
     */
    static syncEvents(sourceCalendarConfig) {
        const sourceCalendar = this.fetchSourceCalendar(sourceCalendarConfig);
        const targetCalendar = this.getOrCreateTargetCalendar(sourceCalendarConfig);
        const targetEvents = this.getTargetEvents(targetCalendar);
    }

    /**
     * @param {CalendarConfig} sourceCalendarConfig
     * @returns {ICSCalendar}
     */
    static fetchSourceCalendar(sourceCalendarConfig) {
        Logger.log(`Fetching iCal data for "${sourceCalendarConfig.name}"...`);

        const response = UrlFetchApp.fetch(sourceCalendarConfig.icsUrl);
        const icsContent = response.getContentText();
        const sourceCalendar = ICSCalendarParser.parseCalendar(sourceCalendarConfig.name, icsContent);

        Logger.log(`Total events: ${sourceCalendar.events.length}`);

        return sourceCalendar;
    }

    /**
     * @param {CalendarConfig} calendarConfig
     * @returns {GoogleAppsScript.Calendar.Schema.Calendar}
     */
    static getOrCreateTargetCalendar(calendarConfig) {
        let calendar = Calendar.CalendarList.list().items.find(x => x.summary === calendarConfig.name);

        if (!calendar) {
            Logger.log(`Calendar "${calendarConfig.name}" not found. Creating...`);

            calendar = Calendar.newCalendar();
            calendar.summary = calendarConfig.name;
            calendar.timeZone = Calendar.Settings.get('timezone').value;
            calendar = Calendar.Calendars.insert(calendar);

            Logger.log(`Calendar "${calendar.summary}" created (id ${calendar.id})`);
        }

        return calendar;
    }

    /**
     * @param {GoogleAppsScript.Calendar.Schema.Calendar} targetCalendar
     * @returns {GoogleAppsScript.Calendar.Schema.Event[]}
     */
    static getTargetEvents(targetCalendar) {
        /** @type {GoogleAppsScript.Calendar.Schema.Events} */
        const eventsList = null;
        /** @type {GoogleAppsScript.Calendar.Schema.Event[]} */
        let result = [];

        Logger.log(`Fetching events from target calendar "${targetCalendar.summary}"`);

        const pageSize = 2500;
        let page = 1;

        do {
            Logger.log(`Fetching page ${page}...`);

            eventsList = Calendar.Events.list(targetCalendar.id, {
                showDeleted: false,
                maxResults: pageSize,
                pageToken: eventsList && eventsList.nextPageToken,
                privateExtendedProperty: `${EXTENDED_PROPERTY.ICAL_SOURCE}=true`,
            });

            result = result.concat(eventsList.items);
            page++;
        } while (eventsList.nextPageToken != null);

        Logger.log(`Found ${result.length} events in target calendar "${targetCalendar.summary}"`);

        return result;
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
        const icsCalendarRawLines = icsCalendarRaw.split(/\r?\n/);

        let eventParser = null;

        for (let i = 0; i < icsCalendarRawLines.length; i++) {
            let tokenRaw = icsCalendarRawLines[i];

            while (icsCalendarRawLines[i + 1] && icsCalendarRawLines[i + 1].startsWith(' ')) {
                tokenRaw += icsCalendarRawLines[i + 1].slice(1);
                i++;
            }

            const token = ICSTokenParser.parseToken(tokenRaw);

            switch (true) {
                case token.is(TOKEN_KEY.BEGIN, TOKEN_VALUE.VEVENT): {
                    eventParser = new ICSEventParser();
                    break;
                }
                case token.is(TOKEN_KEY.END, TOKEN_VALUE.VEVENT): {
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
     * @param {string} icsCalendarRaw
     * @returns {boolean}
     */
    static validate(icsCalendarRaw) {
        return /^BEGIN:VCALENDAR.*END:VCALENDAR$/s.test(icsCalendarRaw);
    }
}

class ICSTokenParser {
    /**
     * @param {string} tokenRaw
     * @returns {ICSToken}
     */
    static parseToken(tokenRaw) {
        const token = new ICSToken();
        const splitIndex = tokenRaw.indexOf(':');

        token.key = tokenRaw.slice(0, splitIndex);
        token.value = tokenRaw.slice(splitIndex + 1).replace(/\\n/g, '\n');

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
        this.event.startDate = ICSDateTimeParser.parseToken(token);
    }

    /**
     * @param {ICSToken} token
     */
    parseDTEnd(token) {
        this.event.endDate = ICSDateTimeParser.parseToken(token);
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
        this.startDate = null;

        /** @type {ICSDateTime} */
        this.endDate = null;
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
        this.key = null;

        /** @type {string} */
        this.value = null;

        /** @type {Map<string, string>} */
        this.properties = new Map();
    }

    /**
     * @param {string} key
     * @param {string} value
     * @returns {boolean}
     */
    is(key, value) {
        return this.key === key && this.value === value;
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

const EXTENDED_PROPERTY = {
    ICAL_SOURCE: 'ICAL_SOURCE',
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
