const { ICSCalendarParser, ICSEvent, ICSDateTime } = require('./main');

parseStringTest('uid', 'UID', e => e.uid);
parseStringTest('summary', 'SUMMARY', e => e.summary);
parseStringTest('description', 'DESCRIPTION', e => e.description);
parseStringTest('url', 'URL', e => e.url);
parseStringTest('location', 'LOCATION', e => e.location);

parseDateTimeTest('dtStart', 'DTSTART', e => e.dtStart);
parseDateTimeTest('dtEnd', 'DTEND', e => e.dtEnd);

/**
 * @param {string} propertyName
 * @param {string} icsToken
 * @param {(event: ICSEvent) => string} propertyGetter
 */
function parseStringTest(propertyName, icsToken, propertyGetter) {
    test(`parse ${propertyName}`, () => {
        const event = singleEvent(`${icsToken}:${propertyName} value`);
        expect(propertyGetter(event)).toBe(`${propertyName} value`);
    });
}

/**
 *
 * @param {string} propertyName
 * @param {string} icsToken
 * @param {(event: ICSEvent) => ICSDateTime} propertyGetter
 */
function parseDateTimeTest(propertyName, icsToken, propertyGetter) {
    test(`parse ${propertyName} (simple)`, () => {
        const event = singleEvent(`${icsToken}:20240506T141312`);

        /** @type {ICSDateTime} */
        const expected = {
            timezoneId: null,
            onlyDate: false,
            date: new Date(2024, 4, 6, 14, 13, 12),
        };

        expect(propertyGetter(event)).toEqual(expected);
    });

    test(`parse ${propertyName} (with TZID)`, () => {
        const event = singleEvent(`${icsToken};TZID=Asia:20240506T141312`);

        /** @type {ICSDateTime} */
        const expected = {
            timezoneId: 'Asia',
            onlyDate: false,
            date: new Date(2024, 4, 6, 14, 13, 12),
        };

        expect(propertyGetter(event)).toEqual(expected);
    });

    test(`parse ${propertyName} (with TZID and VALUE=DATE)`, () => {
        const event = singleEvent(`${icsToken};TZID=Asia;VALUE=DATE:20240506`);

        /** @type {ICSDateTime} */
        const expected = {
            timezoneId: 'Asia',
            onlyDate: true,
            date: new Date(2024, 4, 6),
        };

        expect(propertyGetter(event)).toEqual(expected);
    });

    test(`parse ${propertyName} (with zero TZ)`, () => {
        const event = singleEvent(`${icsToken}:20240506T141312Z`);

        /** @type {ICSDateTime} */
        const expected = {
            timezoneId: null,
            onlyDate: false,
            date: new Date(Date.UTC(2024, 4, 6, 14, 13, 12)),
        };

        expect(propertyGetter(event)).toEqual(expected);
    });
}

/**
 * @param {string} token
 * @returns {ICSEvent}
 */
function singleEvent(token) {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', token, 'END:VEVENT', 'END:VCALENDAR'].join('\n');
    const calendar = ICSCalendarParser.parseCalendar('test', ics);

    return calendar.events[0];
}
