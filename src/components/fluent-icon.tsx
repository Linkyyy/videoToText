import { useId } from "react";

export type FluentIconName =
  | "workspace"
  | "history"
  | "link"
  | "upload"
  | "text"
  | "settings"
  | "help"
  | "sparkles";

/** Original, two-tone pictograms inspired by the dimensional Fluent icon style. */
export function FluentIcon({
  name,
  size = 24,
}: {
  name: FluentIconName;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  const tones: Record<FluentIconName, [string, string]> = {
    workspace: ["#4bc4ff", "#0067c0"],
    history: ["#42d9cc", "#008777"],
    link: ["#6eacff", "#3155cd"],
    upload: ["#bda0ff", "#7654bf"],
    text: ["#60c3ff", "#0877c6"],
    settings: ["#acb9c9", "#586b83"],
    help: ["#ffc76b", "#df7317"],
    sparkles: ["#bda0ff", "#7252c7"],
  };
  const [light, dark] = tones[name];
  const fill = `url(#fluent-${id})`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="fluent-icon"
    >
      <defs>
        <linearGradient
          id={`fluent-${id}`}
          x1="7"
          y1="4"
          x2="26"
          y2="29"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      {name === "workspace" && (
        <>
          <rect x="3" y="5" width="26" height="21" rx="4" fill={fill} />
          <path d="M3 11h26" stroke="#fff" strokeOpacity=".65" />
          <rect
            x="6"
            y="14"
            width="7"
            height="9"
            rx="1.5"
            fill="#fff"
            fillOpacity=".9"
          />
          <path
            d="M17 16h8m-8 5h6"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
      {name === "history" && (
        <>
          <path
            d="M3 10a3 3 0 0 1 3-3h7l3 3h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"
            fill={fill}
          />
          <path d="M4 13h23" stroke="#fff" strokeOpacity=".55" />
          <circle
            cx="22"
            cy="23"
            r="7.5"
            fill="#f3fffc"
            stroke="#008777"
            strokeWidth="1.5"
          />
          <path
            d="M22 19v4l3 1.5"
            stroke="#00776a"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {name === "link" && (
        <>
          <path
            d="m13 12 5-5a6 6 0 0 1 8.5 8.5l-5 5"
            stroke={fill}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="m19 20-5 5a6 6 0 0 1-8.5-8.5l5-5"
            stroke={fill}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="m11 21 10-10"
            stroke="#4464da"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </>
      )}
      {name === "upload" && (
        <>
          <path
            d="M8 26a6 6 0 0 1-1-12 9 9 0 0 1 17-3 7.5 7.5 0 0 1 1 15Z"
            fill={fill}
          />
          <path
            d="M16 24V13m-4 4 4-4 4 4"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {name === "text" && (
        <>
          <path
            d="M8 3h12l7 7v17a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"
            fill={fill}
          />
          <path d="M20 3v5a2 2 0 0 0 2 2h5" fill="#c9edff" />
          <path
            d="M10 15h12m-12 5h12m-12 5h8"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      )}
      {name === "settings" && (
        <>
          <path
            d="m13 3 6 0 1 4 3 2 4-1 3 5-3 3v3l3 3-3 5-4-1-3 2-1 3h-6l-1-4-3-2-4 1-3-5 3-3v-3l-3-3 3-5 4 1 3-2Z"
            transform="translate(0 -1)"
            fill={fill}
          />
          <circle cx="16" cy="16" r="6" fill="#edf6ff" />
          <circle cx="16" cy="16" r="3" fill="#2083d4" />
        </>
      )}
      {name === "help" && (
        <>
          <path d="M5 6a3 3 0 0 1 3-3h17v25H8a3 3 0 0 1-3-3Z" fill={fill} />
          <path
            d="M9 4v21m-4 0c0-2 2-3 4-3h16"
            stroke="#fff"
            strokeOpacity=".6"
            strokeWidth="1.3"
          />
          <path
            d="M14 10a3 3 0 0 1 6 0c0 2-3 2-3 4"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="17" cy="18" r="1.2" fill="#fff" />
        </>
      )}
      {name === "sparkles" && (
        <>
          <path
            d="m16 5 3.7 8.3L28 17l-8.3 3.7L16 29l-3.7-8.3L4 17l8.3-3.7Z"
            fill={fill}
          />
          <path
            d="m26 1 1.4 3.6L31 6l-3.6 1.4L26 11l-1.4-3.6L21 6l3.6-1.4ZM5 1l1.1 2.9L9 5 6.1 6.1 5 9 3.9 6.1 1 5l2.9-1.1Z"
            fill="#bda0ff"
          />
        </>
      )}
    </svg>
  );
}
