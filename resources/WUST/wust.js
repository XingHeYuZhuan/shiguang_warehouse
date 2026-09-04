// 武汉科技大学教务系统课程表导入脚本

(function () {
	"use strict";

	var SCHEDULE_PATH = "/jsxsd/xskb/xskb_list.do";
	var DEFAULT_TIME_SLOTS = [
		{ number: 1, startTime: "08:20", endTime: "09:05" },
		{ number: 2, startTime: "09:15", endTime: "10:00" },
		{ number: 3, startTime: "10:20", endTime: "11:05" },
		{ number: 4, startTime: "11:15", endTime: "12:00" },
		{ number: 5, startTime: "14:00", endTime: "14:45" },
		{ number: 6, startTime: "14:55", endTime: "15:40" },
		{ number: 7, startTime: "16:00", endTime: "16:45" },
		{ number: 8, startTime: "16:55", endTime: "17:40" },
		{ number: 9, startTime: "18:40", endTime: "19:25" },
		{ number: 10, startTime: "19:35", endTime: "20:20" },
		{ number: 11, startTime: "20:40", endTime: "21:25" },
		{ number: 12, startTime: "21:35", endTime: "22:20" }
	];
	function toast(message) {
		if (window.shiguangBridge && window.shiguangBridge.showToast) {
			window.shiguangBridge.showToast(message);
		}
	}

	function normalizeText(value) {
		return (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function parseWeeks(value) {
		var text = normalizeText(value).replace(/\(周\)|周/g, "");
		var weeks = new Set();
		text.split(",").forEach(function (part) {
			var range = part.trim().split("-").map(function (item) {
				return parseInt(item, 10);
			});
			if (!Number.isFinite(range[0])) return;
			var end = Number.isFinite(range[1]) ? range[1] : range[0];
			for (var week = range[0]; week <= end; week++) weeks.add(week);
		});
		return Array.from(weeks).sort(function (a, b) { return a - b; });
	}

	function parsePeriods(value) {
		var match = normalizeText(value).match(/\[([^\]]+)\]/);
		if (!match) return [];
		var numbers = match[1].match(/\d+/g);
		if (!numbers || numbers.length === 0) return [];
		var start = parseInt(numbers[0], 10);
		var end = parseInt(numbers[numbers.length - 1], 10);
		var periods = [];
		for (var period = start; period <= end; period++) periods.push(period);
		return periods;
	}

	function findScheduleDocument() {
		if (document.querySelector("#kbtable")) return document;
		return Array.from(document.querySelectorAll("iframe")).reduce(function (found, frame) {
			if (found) return found;
			try {
				var frameDoc = frame.contentDocument || frame.contentWindow.document;
				return frameDoc && frameDoc.querySelector("#kbtable") ? frameDoc : null;
			} catch (error) {
				return null;
			}
		}, null);
	}

	function parseCourseBlock(block) {
		var holder = document.createElement("div");
		holder.innerHTML = block;
		var lines = Array.from(holder.querySelectorAll("font[title]")).reduce(function (result, font) {
			result[font.getAttribute("title")] = normalizeText(font.textContent);
			return result;
		}, {});
		var firstLine = holder.innerHTML.split(/<br\s*\/?\s*>/i)[0];
		var nameHolder = document.createElement("div");
		nameHolder.innerHTML = firstLine;
		var name = normalizeText(nameHolder.textContent);
		var weekPeriod = lines["周次(节次)"] || "";
		var periods = parsePeriods(weekPeriod);
		var weeks = parseWeeks(weekPeriod.split("[")[0]);
		if (!name || weeks.length === 0 || periods.length === 0) return null;
		return {
			name: name,
			teacher: lines["老师"] || "",
			position: lines["教室"] || "未指定",
			weeks: weeks,
			startSection: periods[0],
			endSection: periods[periods.length - 1]
		};
	}

	function parseCourses(doc) {
		var table = doc.querySelector("#kbtable");
		if (!table) return [];
		var courses = new Map();

		Array.from(table.querySelectorAll("div.kbcontent")).forEach(function (div) {
			var idParts = (div.id || "").split("-");
			var weekday = parseInt(idParts[idParts.length - 2], 10);
			if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) return;

			var blocks = div.innerHTML.split(/<br\s*\/?\s*>\s*[-—]{10,}\s*<br\s*\/?\s*>/i);
			blocks.forEach(function (block) {
				var course = parseCourseBlock(block);
				if (!course) return;
				course.day = weekday;
				var key = [course.name, course.teacher, course.position, weekday, course.weeks.join(",")].join("|");
				if (!courses.has(key)) {
					courses.set(key, course);
					return;
				}
				var existing = courses.get(key);
				existing.startSection = Math.min(existing.startSection, course.startSection);
				existing.endSection = Math.max(existing.endSection, course.endSection);
			});
		});

		return Array.from(courses.values()).sort(function (a, b) {
			return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
		});
	}

	function parseTimeSlots(doc) {
		var slots = new Map();
		Array.from(doc.querySelectorAll("#kbtable tr")).forEach(function (row) {
			var header = row.querySelector("th");
			if (!header) return;
			var match = normalizeText(header.textContent).match(/^(?:第\s*)?(\d+).*?(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
			if (!match) return;
			var number = parseInt(match[1], 10);
			if (number > 0 && !slots.has(number)) {
				slots.set(number, { number: number, startTime: match[2].padStart(5, "0"), endTime: match[3].padStart(5, "0") });
			}
		});
		return slots.size > 0
			? Array.from(slots.values()).sort(function (a, b) { return a.number - b.number; })
			: DEFAULT_TIME_SLOTS.slice();
	}

	function getSemesterId(doc) {
		var select = doc.querySelector("#xnxq01id");
		return select ? select.value : "";
	}

	async function fetchScheduleDocument(semesterId) {
		var body = "cj0701id=&zc=&demo=&xnxq01id=" + encodeURIComponent(semesterId) + "&sfFD=1&wkbkc=1";
		var response = await fetch(SCHEDULE_PATH, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			credentials: "include",
			body: body
		});
		if (!response.ok) throw new Error("课表请求失败：HTTP " + response.status);
		return new DOMParser().parseFromString(await response.text(), "text/html");
	}

	async function saveData(courses, timeSlots) {
		var maxWeek = Math.max.apply(null, courses.map(function (course) {
			return Math.max.apply(null, course.weeks);
		}));
		var config = {
			semesterTotalWeeks: Number.isFinite(maxWeek) && maxWeek > 0 ? maxWeek : 20,
			firstDayOfWeek: 1,
			defaultClassDuration: 45,
			defaultBreakDuration: 5
		};
		if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
			await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
		}
		if (timeSlots.length > 0 && window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
			await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
		}
		return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
	}

	async function runImport() {
		try {
			var currentDoc = findScheduleDocument() || document;
			var semesterId = getSemesterId(currentDoc);
			var scheduleDoc = currentDoc.querySelector("#kbtable") ? currentDoc : await fetchScheduleDocument(semesterId);
			var courses = parseCourses(scheduleDoc);
			if (courses.length === 0) {
				toast("未解析到课程，请确认已登录且课表页面已加载完成");
				return;
			}
			var saved = await saveData(courses, parseTimeSlots(scheduleDoc));
			if (!saved) {
				toast("课程导入失败");
				return;
			}
			toast("成功导入 " + courses.length + " 门课程");
			if (window.shiguangBridge.notifyTaskCompletion) window.shiguangBridge.notifyTaskCompletion();
		} catch (error) {
			console.error("WUST import failed:", error);
			toast("导入失败：" + error.message);
		}
	}

	if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
		runImport();
	}
})();
