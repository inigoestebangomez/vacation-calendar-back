import ical from "ical";
import { join } from "path";

const { parseFile } = ical;

function getHolidayDatesFromICS(filename, dateFormatter) {
    try {
        const filePath = join(process.cwd(), "uploads", filename);
        
        const data = parseFile(filePath);
        const holidays = Object.values(data)
            .filter(event => event.type === "VEVENT")
            .map(event => {
                let dateString = "";
                if (event.start) {
                    const date = new Date(event.start);
                    if (!isNaN(date.getTime())) {
                        dateString = date.toISOString().split("T")[0];
                    }
                }
                return {
                    date: dateString,
                    title: event.summary || "Festivo",
                    description: event.description || ""
                };
            })
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        return holidays;
    } catch (error) {
        console.error("Error parsing ICS:", error);
        return [];
    }
}

function getHolidaysByYear(filename, year, dateFormatter) {
    try {
        const holidays = getHolidayDatesFromICS(filename, dateFormatter);
        return holidays.filter(holiday => {
            const holidayYear = new Date(holiday.date).getFullYear();
            return holidayYear === year;
        });
    } catch (error) {
        console.log("Error filtering holidays by year:", error);
        return [];
    }
}

export { getHolidayDatesFromICS, getHolidaysByYear };