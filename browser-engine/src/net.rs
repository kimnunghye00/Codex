use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use std::error::Error;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;
use url::Url;

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub fn fetch_https(input: &str) -> Result<HttpResponse, Box<dyn Error>> {
    let url = Url::parse(input)?;

    if url.scheme() != "https" {
        return Err("only https:// URLs are allowed in browser-core 0.1".into());
    }

    let host = url
        .host_str()
        .ok_or("URL does not contain a valid host")?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(443);

    let mut path = url.path().to_string();
    if path.is_empty() {
        path.push('/');
    }
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }

    let address = format!("{host}:{port}");
    let tcp = TcpStream::connect(address)?;
    tcp.set_read_timeout(Some(IO_TIMEOUT))?;
    tcp.set_write_timeout(Some(IO_TIMEOUT))?;

    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    let server_name = ServerName::try_from(host.clone())
        .map_err(|_| "host name cannot be used for TLS verification")?;
    let connection = ClientConnection::new(Arc::new(config), server_name)?;
    let mut tls = StreamOwned::new(connection, tcp);

    let host_header = if port == 443 {
        host.clone()
    } else {
        format!("{host}:{port}")
    };

    let request = format!(
        "GET {path} HTTP/1.1\r\n\
         Host: {host_header}\r\n\
         User-Agent: browser-core/0.1\r\n\
         Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.1\r\n\
         Accept-Encoding: identity\r\n\
         Connection: close\r\n\
         \r\n"
    );

    tls.write_all(request.as_bytes())?;
    tls.flush()?;

    let mut raw = Vec::with_capacity(32 * 1024);
    let mut chunk = [0_u8; 8192];

    loop {
        let read = tls.read(&mut chunk)?;
        if read == 0 {
            break;
        }

        if raw.len().saturating_add(read) > MAX_RESPONSE_BYTES {
            return Err(format!(
                "response exceeded the {} byte safety limit",
                MAX_RESPONSE_BYTES
            )
            .into());
        }

        raw.extend_from_slice(&chunk[..read]);
    }

    parse_http_response(&raw)
}

fn parse_http_response(raw: &[u8]) -> Result<HttpResponse, Box<dyn Error>> {
    let header_end = find_bytes(raw, b"\r\n\r\n")
        .ok_or("invalid HTTP response: header terminator not found")?;
    let header_bytes = &raw[..header_end];
    let body_bytes = &raw[header_end + 4..];
    let headers = std::str::from_utf8(header_bytes)?;

    let mut lines = headers.lines();
    let status_line = lines.next().ok_or("missing HTTP status line")?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .ok_or("missing HTTP status code")?
        .parse::<u16>()?;

    let mut chunked = false;
    let mut content_length: Option<usize> = None;

    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };

        if name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
        {
            chunked = true;
        }

        if name.eq_ignore_ascii_case("content-length") {
            if let Ok(length) = value.trim().parse::<usize>() {
                content_length = Some(length);
            }
        }
    }

    if let Some(length) = content_length {
        if length > MAX_RESPONSE_BYTES {
            return Err("Content-Length exceeds the browser safety limit".into());
        }
    }

    let body = if chunked {
        decode_chunked(body_bytes)?
    } else {
        let end = content_length
            .map(|length| length.min(body_bytes.len()))
            .unwrap_or(body_bytes.len());
        body_bytes[..end].to_vec()
    };

    Ok(HttpResponse { status, body })
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut output = Vec::new();
    let mut cursor = 0;

    loop {
        let line_end_rel = find_bytes(&input[cursor..], b"\r\n")
            .ok_or("invalid chunked body: missing chunk-size terminator")?;
        let line_end = cursor + line_end_rel;
        let size_text = std::str::from_utf8(&input[cursor..line_end])?;
        let size_text = size_text.split(';').next().unwrap_or(size_text).trim();
        let size = usize::from_str_radix(size_text, 16)?;

        cursor = line_end + 2;

        if size == 0 {
            break;
        }

        if size > MAX_RESPONSE_BYTES
            || output.len().saturating_add(size) > MAX_RESPONSE_BYTES
            || cursor.saturating_add(size + 2) > input.len()
        {
            return Err("invalid or oversized chunked body".into());
        }

        output.extend_from_slice(&input[cursor..cursor + size]);
        cursor += size;

        if input.get(cursor..cursor + 2) != Some(b"\r\n") {
            return Err("invalid chunked body: missing chunk terminator".into());
        }
        cursor += 2;
    }

    Ok(output)
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_response() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello";
        let response = parse_http_response(raw).unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"hello");
    }

    #[test]
    fn parses_chunked_response() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n";
        let response = parse_http_response(raw).unwrap();
        assert_eq!(response.body, b"hello");
    }
}
