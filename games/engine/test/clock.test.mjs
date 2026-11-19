import test from "node:test";
import assert from "node:assert/strict";
import { addDays, compare, dayOfWeek, diffDays, format, fromDayNumber, isBefore, month, parse, season, toDayNumber } from "../clock.js";

test("adds days across month and year ends", () => {
  assert.equal(addDays("1836-09-15", 1), "1836-09-16");
  assert.equal(addDays("1836-09-30", 1), "1836-10-01");
  assert.equal(addDays("1836-12-31", 1), "1837-01-01");
  assert.equal(addDays("1836-03-01", -1), "1836-02-29"); // 1836 was a leap year
  assert.equal(addDays("1836-09-15", 91), "1836-12-15");
});

test("day numbers round-trip", () => {
  for (const d of ["1836-01-01", "1836-02-29", "1836-12-15", "1837-03-29"]) assert.equal(fromDayNumber(toDayNumber(d)), d);
});

test("differences and comparison", () => {
  assert.equal(diffDays("1836-09-15", "1836-12-15"), 91);
  assert.equal(compare("1836-12-15", "1836-12-16"), -1);
  assert.equal(compare("1836-12-15", "1836-12-15"), 0);
  assert.ok(isBefore("1836-11-30", "1836-12-01"));
});

test("day of week matches the 1836 calendar", () => {
  assert.equal(dayOfWeek("1836-09-15"), 4); // Thursday
  assert.equal(dayOfWeek("1836-12-15"), 4); // Thursday
  assert.equal(format("1836-09-15"), "Thursday, 15 September 1836");
  assert.equal(format("1836-09-15", { weekday: false }), "15 September 1836");
});

test("month and season", () => {
  assert.equal(month("1836-10-02"), 10);
  assert.equal(season("1836-09-15"), "autumn");
  assert.equal(season("1836-12-01"), "winter");
  assert.equal(season("1837-04-01"), "spring");
  assert.equal(season("1836-07-04"), "summer");
});

test("rejects malformed dates", () => {
  assert.throws(() => parse("15 Sept 1836"));
});
