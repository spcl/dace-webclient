/**
 * Loading indicator courtesy of loading.io/css - licensed CC0
 */
function ellipsisSpinnerHTML() {
    const className = `dace-loading-ellipsis-${Math.random() * 1_000_000 | 1}`;
    return `
        <div class="${className}-parent" style="position: absolute; top: 0; bottom: 0; left: 0; right: 0; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            <style>
                .${className}-parent > * {
                    position: relative;
                    animation: ${className}-fadein 0.1s 0.25s forwards;
                    opacity: 0%;
                }
                .${className} {
                    width: 80px;
                    height: 80px;
                }
                .${className} div {
                    position: absolute;
                    top: 33px;
                    width: 13px;
                    height: 13px;
                    border-radius: 50%;
                    background: var(--loading-spinner-color, #000000);
                    animation-timing-function: cubic-bezier(0, 1, 1, 0);
                }
                .${className} div:nth-of-type(1) {
                    left: 8px;
                    animation: ${className}-anim1 0.6s infinite;
                }
                .${className} div:nth-of-type(2) {
                    left: 8px;
                    animation: ${className}-anim2 0.6s infinite;
                }
                .${className} div:nth-of-type(3) {
                    left: 32px;
                    animation: ${className}-anim2 0.6s infinite;
                }
                .${className} div:nth-of-type(4) {
                    left: 56px;
                    animation: ${className}-anim3 0.6s infinite;
                }
                @keyframes ${className}-anim1 {
                    0% { transform: scale(0); }
                    100% { transform: scale(1); }
                }
                @keyframes ${className}-anim3 {
                    0% { transform: scale(1); }
                    100% { transform: scale(0); }
                }
                @keyframes ${className}-anim2 {
                    0% { transform: translate(0, 0); }
                    100% { transform: translate(24px, 0); }
                }
                @keyframes ${className}-fadein {
                    0% { opacity: 0; }
                    100% { opacity: 1; }
                }
            </style>
            <div class="${className}">
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>
        </div>
    `;
}

export function createSpinner(caption = ''): {
    element: ChildNode,
    setCaption: (s: string) => void,
} {
    const template = document.createElement('template');
    template.innerHTML = ellipsisSpinnerHTML().trim();

    const cap = document.createElement('div');
    cap.innerText = caption;
    cap.style.whiteSpace = 'nowrap';
    template.content.firstChild?.appendChild(cap);

    return {
        element: template.content.firstChild!,
        setCaption: (s) => cap.innerText = s,
    };
}
