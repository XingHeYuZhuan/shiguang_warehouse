const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const adapter = fs.readFileSync(path.join(__dirname, '../resources/YANGTZEU/yu.js'), 'utf8');

// Synthetic EAMS data; the repeated index assignments follow the observed page format.
// No student identifiers, real teachers, or personal timetable data are used here.
function activity({ name = '测试实验', teacher = '测试教师', weeks = '011010', indices = ['6*unitCount+0'], expression = false } = {}) {
    const teacherExpression = expression ? "actTeacherName.join(',')" : JSON.stringify(teacher);
    return `
        var actTeachers = [{id: 1, name: ${JSON.stringify(teacher)}, lab: false}];
        var actTeacherName = [];
        for (var i = 0; i < actTeachers.length; i++) {
            actTeacherName.push(actTeachers[i].name);
        }
        activity = new TaskActivity('', ${teacherExpression}, 'course-id', ${JSON.stringify(name + '(123.1)')}, 'room-id', '测试教室', '${weeks}', null, null, '', '', '');
        ${indices.map(index => `index = ${index}; table0.activities[index][table0.activities[index].length] = activity;`).join('\n')}
    `;
}

async function runAdapter(courseScript, { selection = 0, entry = true } = {}) {
    const result = { courses: [], slots: [], requests: [], alerts: [], toasts: [], writes: 0, completed: false };
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const context = {
        console: { error() {}, log() {} },
        fetch: async (url, options) => {
            result.requests.push({ url, options });
            let text;
            if (url.includes('courseTableForStd!courseTable.action')) {
                text = `<script>var unitCount = 8; var activity = null; ${courseScript}</script>`;
            } else if (url.includes('dataQuery.action')) {
                text = `({semesters: {'2026': [{id: '1', schoolYear: '2026-2027', name: '1'}]}})`;
            } else {
                text = entry ? '<input id="semesterBar123Semester"><script>bg.form.addInput(form,"ids","1001");</script>' : '<form>请先登录</form>';
            }
            return { ok: true, text: async () => text };
        },
        window: {
            shiguangBridgePromise: {
                showAlert: async (...args) => { result.alerts.push(args); finish(); return true; },
                showSingleSelection: async () => selection,
                saveImportedCourses: async data => { result.courses = JSON.parse(data); result.writes++; },
                savePresetTimeSlots: async data => { result.slots = JSON.parse(data); result.writes++; }
            },
            shiguangBridge: {
                showToast(message) {
                    result.toasts.push(message);
                    if (/已取消|导入失败/.test(message)) finish();
                },
                notifyTaskCompletion() { result.completed = true; finish(); }
            }
        }
    };
    vm.runInNewContext(adapter, context, { timeout: 1000 });
    let timer;
    try {
        await Promise.race([
            finished,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Adapter did not finish')), 2000); })
        ]);
    } finally {
        clearTimeout(timer);
    }
    return result;
}

test('preserves both consecutive slots of one activity and the resulting end time', async () => {
    const result = await runAdapter(activity({ indices: ['6*unitCount+0', '6*unitCount+1'], expression: true }));
    assert.equal(result.completed, true);
    assert.equal(result.courses.length, 1);
    assert.deepEqual(result.courses[0], {
        name: '测试实验', teacher: '测试教师', position: '测试教室', day: 7,
        startSection: 1, endSection: 2, weeks: [1, 2, 4]
    });
    assert.equal(result.slots.find(slot => slot.number === result.courses[0].endSection).endTime, '11:40');
    assert.equal(result.requests.length, 3);
});

test('keeps noncontiguous periods separate after the school-specific slot mapping', async () => {
    const result = await runAdapter(activity({ indices: ['0*unitCount+0', '0*unitCount+2'] }));
    assert.deepEqual(result.courses.map(course => [course.startSection, course.endSection]), [[1, 1], [4, 4]]);
});

test('keeps assignments on different days', async () => {
    const result = await runAdapter(activity({ indices: ['0*unitCount+0', '2*unitCount+0'] }));
    assert.deepEqual(result.courses.map(course => course.day), [1, 3]);
});

test('supports repeated direct numeric indices', async () => {
    const result = await runAdapter(activity({ indices: ['48', '49'] }));
    assert.deepEqual(result.courses.map(course => [course.day, course.startSection, course.endSection]), [[7, 1, 2]]);
});

test('does not assign the next activity to the previous course', async () => {
    const result = await runAdapter(
        activity({ name: '课程A', teacher: '教师A', indices: ['0*unitCount+0', '0*unitCount+1'], expression: true }) +
        activity({ name: '课程B', teacher: '教师B', indices: ['2*unitCount+2'], expression: true })
    );
    assert.deepEqual(result.courses.map(({ name, teacher, day, startSection, endSection }) => ({ name, teacher, day, startSection, endSection })), [
        { name: '课程A', teacher: '教师A', day: 1, startSection: 1, endSection: 2 },
        { name: '课程B', teacher: '教师B', day: 3, startSection: 4, endSection: 4 }
    ]);
});

test('does not interpret constructor-like punctuation inside quoted names', async () => {
    const result = await runAdapter(activity({ name: '实验); 课程 "A"', expression: true }));
    assert.equal(result.courses[0].name, '实验); 课程 "A"');
    assert.equal(result.courses[0].teacher, '测试教师');
});

test('keeps empty scheduled teachers empty instead of borrowing the preceding teacher', async () => {
    const result = await runAdapter(
        activity({ name: '课程A', expression: true }) +
        activity({ name: '课程B', teacher: '', indices: ['3*unitCount+3'], expression: true })
    );
    assert.equal(result.courses.find(course => course.name === '课程B').teacher, '');
});

test('cancelled semester selection writes no data', async () => {
    const result = await runAdapter(activity(), { selection: null });
    assert.equal(result.writes, 0);
    assert.equal(result.completed, false);
});

test('missing login parameters writes no data', async () => {
    const result = await runAdapter(activity(), { entry: false });
    assert.equal(result.writes, 0);
    assert.equal(result.alerts.length, 1);
});

test('empty timetable writes no data', async () => {
    const result = await runAdapter('');
    assert.equal(result.writes, 0);
    assert.equal(result.completed, false);
});
