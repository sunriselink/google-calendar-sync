const { ICSParser, ICSCalendar } = require('./main');

test('parse event', () => {
    const calendar = ICSParser.parseCalendar(SINGLE_EVENT);

    /** @type {ICSCalendar} */
    const expected = {
        events: [
            {
                uid: 'some uid',
                summary: 'some summary',
                description: 'some description',
                url: 'some url',
                location: 'some location',
            },
        ],
    };

    expect(calendar).toEqual(expected);
});

const SINGLE_EVENT = `
BEGIN:VEVENT
UID:some uid
SUMMARY:some summary
DESCRIPTION:some description
URL:some url
LOCATION:some location
END:VEVENT
`;
