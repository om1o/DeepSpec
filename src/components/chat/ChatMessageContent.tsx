import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessageContentProps = {
  content: string;
  markdown?: boolean;
};

export function ChatMessageContent({ content, markdown = false }: ChatMessageContentProps) {
  if (!markdown) {
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  }

  return (
    <div className="ds-chat-markdown break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => {
            const safeHref = getSafeHttpsUrl(href);
            return safeHref
              ? <a href={safeHref} rel="noopener noreferrer" target="_blank">{children}</a>
              : <span>{children}</span>;
          },
          img: ({ alt }) => alt ? <span>[Image: {alt}]</span> : null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function getSafeHttpsUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
