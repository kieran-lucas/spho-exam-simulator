use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: String,
    pub exam_id: String,
    pub title: String,
    pub description: String,
    pub duration_seconds: u32,
    pub question_count: usize,
    pub sections: Vec<Section>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub id: String,
    pub title: String,
    pub question_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Block {
    Markdown {
        content: String,
    },
    Image {
        src: String,
        alt: String,
        #[serde(default)]
        caption: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    pub key: String,
    pub content: Vec<Block>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Question {
    pub id: String,
    pub section: String,
    pub topic: String,
    pub tags: Vec<String>,
    pub stem: Vec<Block>,
    pub choices: Vec<Choice>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Solution {
    pub question_id: String,
    pub correct_choice: String,
    pub explanation: Vec<Block>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<Vec<Block>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pitfalls: Option<Vec<Block>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exam {
    pub manifest: Manifest,
    pub questions: Vec<Question>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub question_id: String,
    pub choice: Option<String>,
    pub flagged: bool,
    pub note: String,
    pub viewing_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: String,
    pub exam_id: String,
    pub status: String,
    pub started_at: String,
    pub submitted_at: Option<String>,
    pub elapsed_ms: u64,
    pub current_question: usize,
    pub score: Option<u32>,
    pub responses: Vec<Response>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryExam {
    pub manifest: Manifest,
    pub hash: String,
    pub imported_at: String,
    pub attempts: Vec<Attempt>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub question_id: String,
    // A field is only applied when its corresponding 'set' boolean is true.
    #[serde(default)]
    pub set_choice: bool,
    pub choice: Option<String>,
    pub flagged: Option<bool>,
    pub note: Option<String>,
    pub current_question: Option<usize>,
}
pub type AppResult<T> = Result<T, String>;
