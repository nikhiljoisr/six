//! The planning coach's questions and its policy. Pure: builds one request for a list of
//! task titles and turns the answers into at most one hint per row. The model never
//! writes text; it answers narrow questions with probabilities and the words are chosen
//! here. Off unless switched on in Settings, and asked only when the user presses "Check
//! the list".
//!
//! The same request and the same policy live in `tools/typesafe-eval` (`buildAppRequest`,
//! `compose`), where they are scored against labelled lists. Both are pinned to
//! `tools/typesafe-eval/fixtures/app-request.json`, so they cannot drift apart silently.

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::model::MAX_TASKS;

pub const MODEL: &str = "jev-latest";

// Thresholds, as evaluated on 3 Oct 2026 (42 labelled rows, four runs, no false alarm):
// traps for the word "and" reached 0.76 and real two-in-ones started at 0.91.
const SAME: f64 = 0.8;
const COMPOUND: f64 = 0.85;
const NO_FINISH: f64 = 0.25;
const BIG: f64 = 2.5;
const BIG_CONFIDENCE: f64 = 0.5;

/// One quiet remark about a row. At most one per row, in this order of usefulness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Hint {
    /// The same work as an earlier row (1-based position among the titles sent).
    SameAs { row: u8 },
    TwoTasks,
    NoFinish,
    MostOfADay,
}

fn noul(instructions: String, yes: &str, no: &str) -> Value {
    json!({
        "type": "noul",
        "instructions": instructions,
        "criteria": { "true": yes, "false": no },
    })
}

/// The request for a list: the titles, in order, and nothing else of the user's. Notes
/// are never sent. `titles` holds at most six (the caller checks).
pub fn request(titles: &[String]) -> Value {
    let tasks: Vec<Value> = titles
        .iter()
        .enumerate()
        .map(|(i, title)| json!({ "position": i + 1, "title": title }))
        .collect();
    let mut questions = Map::new();
    for i in 0..titles.len() {
        let at = format!("`plan.tasks[{i}].title`");
        questions.insert(
            format!("compound_{i}"),
            noul(
                format!("Does the task at {at} describe more than one distinct piece of work, each of which could be finished separately?"),
                "Two or more separable outcomes are joined, for example doing one thing and also deciding another.",
                "One outcome, even when a single action covers several objects, such as sending a list and its attachments.",
            ),
        );
        questions.insert(
            format!("finish_{i}"),
            noul(
                format!("Could an outside observer tell when the task at {at} is finished?"),
                "It names a concrete outcome, deliverable or event: something sent, booked, drafted, decided, attended.",
                "It is an open-ended activity with no stated end, such as working on, thinking about or looking into something.",
            ),
        );
        questions.insert(
            format!("size_{i}"),
            json!({
                "type": "score",
                "instructions": format!("How much focused work does the task at {at} most plausibly need?"),
                "criteria": [
                    "A few minutes: a quick message, call or booking",
                    "Under an hour of focused work",
                    "One to three hours of focused work",
                    "Most of a working day or more, or open-ended",
                ],
            }),
        );
        for j in (i + 1)..titles.len() {
            questions.insert(
                format!("same_{i}_{j}"),
                noul(
                    format!("Do the tasks at {at} and `plan.tasks[{j}].title` describe the same piece of work, so that finishing one finishes the other?"),
                    "The same work in different words.",
                    "Different work, even if it involves the same person, project or topic.",
                ),
            );
        }
    }
    json!({
        "state": {
            "method": "The Ivy Lee method: each evening, write down at most six tasks for tomorrow, most important first. Each task should be one piece of work that can be finished before starting the next.",
            "plan": { "tasks": tasks },
        },
        "model": MODEL,
        "questions": questions,
    })
}

fn number(answers: &Value, id: &str, field: &str) -> Option<f64> {
    answers.get(id)?.get(field)?.as_f64().filter(|n| n.is_finite())
}

/// At most one hint per row, from the `answers` map of a response. An answer that is
/// missing or not a number is no evidence: that row simply gets no hint from it.
pub fn hints(count: usize, answers: &Value) -> Vec<Option<Hint>> {
    let count = count.min(MAX_TASKS);
    (0..count)
        .map(|i| {
            // The nearest earlier row that is the same work.
            let twin = (0..i)
                .rev()
                .find(|j| number(answers, &format!("same_{j}_{i}"), "noul").is_some_and(|p| p >= SAME));
            if let Some(j) = twin {
                return Some(Hint::SameAs {
                    row: u8::try_from(j + 1).unwrap_or(u8::MAX),
                });
            }
            if number(answers, &format!("compound_{i}"), "noul").is_some_and(|p| p >= COMPOUND) {
                return Some(Hint::TwoTasks);
            }
            if number(answers, &format!("finish_{i}"), "noul").is_some_and(|p| p <= NO_FINISH) {
                return Some(Hint::NoFinish);
            }
            let size = number(answers, &format!("size_{i}"), "score");
            let sure = number(answers, &format!("size_{i}"), "confidence");
            if size.is_some_and(|s| s >= BIG) && sure.is_some_and(|c| c >= BIG_CONFIDENCE) {
                return Some(Hint::MostOfADay);
            }
            None
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn titles(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| (*t).to_string()).collect()
    }

    #[test]
    fn the_request_is_the_one_the_bench_evaluates() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../tools/typesafe-eval/fixtures/app-request.json")).unwrap();
        let built = request(&titles(&[
            "Send the Q3 numbers to Priya",
            "Work on the website",
            "Ring the accountant re: tax filing",
        ]));
        assert_eq!(built, fixture);
    }

    #[test]
    fn a_list_of_six_asks_thirty_three_questions_and_sends_titles_only() {
        let built = request(&titles(&["A", "B", "C", "D", "E", "F"]));
        assert_eq!(built["questions"].as_object().unwrap().len(), 6 * 3 + 15);
        let task = &built["state"]["plan"]["tasks"][5];
        assert_eq!(task, &json!({ "position": 6, "title": "F" }));
        assert_eq!(request(&[])["questions"].as_object().unwrap().len(), 0);
    }

    fn answers() -> Value {
        // Row 0 plain; row 1 two-in-one; row 2 no finish; row 3 big; row 4 same as row 0
        // (and also vague, which the earlier hint outranks); row 5 an "and" trap at 0.76.
        json!({
            "compound_0": {"type": "noul", "noul": 0.07}, "finish_0": {"type": "noul", "noul": 0.94},
            "size_0": {"type": "score", "score": 0.6, "confidence": 0.8},
            "compound_1": {"type": "noul", "noul": 0.92}, "finish_1": {"type": "noul", "noul": 0.81},
            "size_1": {"type": "score", "score": 1.8, "confidence": 0.7},
            "compound_2": {"type": "noul", "noul": 0.22}, "finish_2": {"type": "noul", "noul": 0.05},
            "size_2": {"type": "score", "score": 2.9, "confidence": 0.9},
            "compound_3": {"type": "noul", "noul": 0.17}, "finish_3": {"type": "noul", "noul": 0.80},
            "size_3": {"type": "score", "score": 2.9, "confidence": 0.9},
            "compound_4": {"type": "noul", "noul": 0.07}, "finish_4": {"type": "noul", "noul": 0.10},
            "size_4": {"type": "score", "score": 0.5, "confidence": 0.9},
            "compound_5": {"type": "noul", "noul": 0.76}, "finish_5": {"type": "noul", "noul": 0.88},
            "size_5": {"type": "score", "score": 1.7, "confidence": 0.9},
            "same_0_4": {"type": "noul", "noul": 0.91}, "same_0_1": {"type": "noul", "noul": 0.02},
            "same_3_5": {"type": "noul", "noul": 0.79},
        })
    }

    #[test]
    fn one_hint_a_row_in_order_of_usefulness() {
        assert_eq!(
            hints(6, &answers()),
            vec![
                None,
                Some(Hint::TwoTasks),
                Some(Hint::NoFinish),
                Some(Hint::MostOfADay),
                Some(Hint::SameAs { row: 1 }),
                None,
            ]
        );
    }

    #[test]
    fn a_big_guess_without_confidence_is_not_said() {
        let mut a = answers();
        a["size_3"]["confidence"] = json!(0.3);
        assert_eq!(hints(6, &a)[3], None);
    }

    #[test]
    fn missing_or_malformed_answers_are_no_evidence() {
        assert_eq!(hints(3, &json!({})), vec![None, None, None]);
        assert_eq!(hints(2, &json!("nonsense")), vec![None, None]);
        let odd = json!({
            "compound_0": {"noul": "0.99"},
            "finish_0": {"noul": null},
            "size_0": {"score": 3.0},
            "same_0_1": {"noul": 0.99, "type": "noul"},
        });
        assert_eq!(hints(2, &odd), vec![None, Some(Hint::SameAs { row: 1 })]);
        assert_eq!(hints(9, &json!({})).len(), 6, "never more rows than a list holds");
    }

    #[test]
    fn hints_serialise_as_the_view_reads_them() {
        assert_eq!(serde_json::to_value(Hint::TwoTasks).unwrap(), json!({"kind": "two_tasks"}));
        assert_eq!(
            serde_json::to_value(Hint::SameAs { row: 5 }).unwrap(),
            json!({"kind": "same_as", "row": 5})
        );
    }
}
