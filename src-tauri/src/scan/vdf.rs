//! Minimal parser for Valve's text KeyValues (".vdf" / ".acf") format.

#[derive(Debug, Clone)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    /// Case-insensitive child lookup.
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(items) => items
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            _ => None,
        }
    }

    /// Follow a path of keys.
    pub fn path(&self, keys: &[&str]) -> Option<&Vdf> {
        let mut cur = self;
        for k in keys {
            cur = cur.get(k)?;
        }
        Some(cur)
    }

    pub fn str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(|v| v.str())
    }

    pub fn get_u64(&self, key: &str) -> Option<u64> {
        self.get_str(key).and_then(|s| s.trim().parse().ok())
    }

    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Obj(items) => items,
            _ => &[],
        }
    }
}

#[derive(Debug, PartialEq)]
enum Tok {
    S(String),
    Open,
    Close,
}

fn tokenize(src: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut chars = src.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            c if c.is_whitespace() => {
                chars.next();
            }
            '{' => {
                chars.next();
                out.push(Tok::Open);
            }
            '}' => {
                chars.next();
                out.push(Tok::Close);
            }
            '/' => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    // line comment
                    for c in chars.by_ref() {
                        if c == '\n' {
                            break;
                        }
                    }
                }
            }
            '"' => {
                chars.next();
                let mut s = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => match chars.next() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(o) => s.push(o),
                            None => break,
                        },
                        '"' => break,
                        o => s.push(o),
                    }
                }
                out.push(Tok::S(s));
            }
            _ => {
                // unquoted token
                let mut s = String::new();
                while let Some(&c) = chars.peek() {
                    if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                        break;
                    }
                    s.push(c);
                    chars.next();
                }
                // skip conditional markers like [$WIN32]
                if !(s.starts_with('[') && s.ends_with(']')) {
                    out.push(Tok::S(s));
                }
            }
        }
    }
    out
}

fn parse_obj(toks: &[Tok], i: &mut usize) -> Vec<(String, Vdf)> {
    let mut items = Vec::new();
    while *i < toks.len() {
        match &toks[*i] {
            Tok::Close => {
                *i += 1;
                break;
            }
            Tok::Open => {
                // stray brace; skip
                *i += 1;
            }
            Tok::S(key) => {
                let key = key.clone();
                *i += 1;
                match toks.get(*i) {
                    Some(Tok::S(v)) => {
                        items.push((key, Vdf::Str(v.clone())));
                        *i += 1;
                    }
                    Some(Tok::Open) => {
                        *i += 1;
                        let child = parse_obj(toks, i);
                        items.push((key, Vdf::Obj(child)));
                    }
                    _ => break,
                }
            }
        }
    }
    items
}

pub fn parse(src: &str) -> Vdf {
    let src = src.trim_start_matches('\u{feff}');
    let toks = tokenize(src);
    let mut i = 0;
    Vdf::Obj(parse_obj(&toks, &mut i))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested() {
        let v = parse(
            r#"
            // comment
            "AppState"
            {
                "appid"     "1086940"
                "name"      "Baldur's Gate 3"
                "StateFlags" "4"
                "UserConfig" { "language" "english" }
                "path"  "C:\\Games\\Steam"
            }"#,
        );
        let a = v.get("appstate").unwrap();
        assert_eq!(a.get_u64("appid"), Some(1086940));
        assert_eq!(a.get_str("name"), Some("Baldur's Gate 3"));
        assert_eq!(a.path(&["UserConfig", "language"]).unwrap().str(), Some("english"));
        assert_eq!(a.get_str("path"), Some("C:\\Games\\Steam"));
    }
}
