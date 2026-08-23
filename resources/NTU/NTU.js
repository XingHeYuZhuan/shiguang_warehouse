(function () {
    "use strict";

    var bridge = window.shiguangBridge;
    var bridgePromise = window.shiguangBridgePromise;

    function parseWeeks(text) {
        var weeks = [];
        String(text || "").split(/[，,、]/).forEach(function (part) {
            part = part.trim();
            if (!part) return;

            var isOdd = /(?:\(单\)|（单）)/.test(part);
            var isEven = /(?:\(双\)|（双）)/.test(part);
            var numbers = part.match(/\d+/g);
            if (!numbers) return;

            var start = parseInt(numbers[0], 10);
            var end = numbers.length > 1 ? parseInt(numbers[1], 10) : start;
            for (var week = start; week <= end; week++) {
                if ((!isOdd && !isEven) || (isOdd && week % 2 === 1) || (isEven && week % 2 === 0)) {
                    weeks.push(week);
                }
            }
        });

        return weeks.filter(function (week, index) {
            return weeks.indexOf(week) === index;
        }).sort(function (left, right) {
            return left - right;
        });
    }

    function cleanText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function cleanTeacher(text) {
        return cleanText(text)
            .replace(/（.*?）|\(.*?\)/g, "")
            .replace(/主讲|辅讲/g, "")
            .split(/[，,]/)
            .map(function (name) { return cleanText(name); })
            .filter(Boolean)
            .join(", ");
    }

    function parseSection(cell) {
        if (!cell) return null;
        var match = cell.id.match(/^jc_\d+-(\d+)(?:-(\d+))?$/);
        if (!match) return null;
        return {
            startSection: parseInt(match[1], 10),
            endSection: parseInt(match[2] || match[1], 10)
        };
    }

    function parseCourses() {
        var table = document.querySelector("#kblist_table");
        if (!table) return { courses: [], maxWeek: 0 };

        var courses = [];
        var maxWeek = 0;
        table.querySelectorAll("tbody[id^='xq_']").forEach(function (dayBody) {
            var dayMatch = dayBody.id.match(/^xq_(\d+)$/);
            var day = dayMatch ? parseInt(dayMatch[1], 10) : 0;
            var section = null;
            if (day < 1 || day > 7) return;

            dayBody.querySelectorAll("tr").forEach(function (row) {
                var sectionCell = row.querySelector("td[id^='jc_']");
                if (sectionCell) section = parseSection(sectionCell);

                var courseCell = row.querySelector(".timetable_con");
                if (!courseCell || !section) return;

                var text = cleanText(courseCell.innerText || courseCell.textContent);
                var title = courseCell.querySelector(".title");
                var weekMatch = text.match(/周次：(.+?)(?=校区：)/);
                var positionMatch = text.match(/上课地点：(.+?)(?=教师：)/);
                var teacherMatch = text.match(/教师：(.+?)(?=教学班：)/);
                var weeks = parseWeeks(weekMatch && weekMatch[1]);
                if (!weeks.length) return;

                maxWeek = Math.max(maxWeek, Math.max.apply(Math, weeks));
                courses.push({
                    name: cleanText(title ? title.textContent.replace(/[■◆▲]/g, "") : "未知课程"),
                    teacher: cleanTeacher(teacherMatch && teacherMatch[1]),
                    position: cleanText(positionMatch && positionMatch[1]),
                    day: day,
                    startSection: section.startSection,
                    endSection: section.endSection,
                    weeks: weeks
                });
            });
        });

        return { courses: courses, maxWeek: maxWeek };
    }

    async function runImport() {
        if (!bridge || !bridgePromise) return;

        try {
            var confirmed = await bridgePromise.showAlert(
                "导入南通大学课表",
                "将读取当前页面中已显示的班级课表。请确认课表已经加载完成。",
                "开始导入"
            );
            if (!confirmed) return;

            var result = parseCourses();
            if (!result.courses.length) {
                bridge.showToast("未找到课程，请先打开班级课表打印结果页面。");
                return;
            }

            await bridgePromise.saveCourseConfig(JSON.stringify({
                semesterTotalWeeks: Math.max(20, result.maxWeek || 20),
                firstDayOfWeek: 1
            }));
            await bridgePromise.saveImportedCourses(JSON.stringify(result.courses));
            bridge.showToast("成功导入 " + result.courses.length + " 条课程安排！");
            bridge.notifyTaskCompletion();
        } catch (error) {
            bridge.showToast("导入失败：" + (error && error.message ? error.message : error));
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runImport);
    } else {
        runImport();
    }
})();
