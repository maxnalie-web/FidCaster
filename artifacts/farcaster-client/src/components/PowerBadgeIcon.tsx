export function PowerBadgeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 2C22 2 24 3.5 24.5 4.5C25.3 5.5 26.8 4.5 28.2 5.1C29.4 6.6 29.4 8.2 28.3 9.7C27.2 11.2 27.7 12.8 29.2 14.1C30.2 16 30.2 18 29.2 19.9C27.7 21.2 27.2 22.8 28.3 24.3C29.4 25.8 29.4 27.4 28.2 28.9C26.8 29.5 25.3 28.5 24.5 29.5C24 30.5 22 32 20 32C18 32 16 30.5 15.5 29.5C14.7 28.5 13.2 29.5 11.8 28.9C10.6 27.4 10.6 25.8 11.7 24.3C12.8 22.8 12.3 21.2 10.8 19.9C9.8 18 9.8 16 10.8 14.1C12.3 12.8 12.8 11.2 11.7 9.7C10.6 8.2 10.6 6.6 11.8 5.1C13.2 4.5 14.7 5.5 15.5 4.5C16 3.5 18 2 20 2Z"
        fill="#7C3AED"
      />
      <path
        d="M14 20.5L17.5 24L26 15"
        stroke="white"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
