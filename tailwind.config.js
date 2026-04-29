/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                success: '#22c55e', // green-500
                warning: '#f59e0b', // amber-500
                danger: '#ef4444',  // red-500
                primary: '#06b6d4', // cyan-500
            }
        },
    },
    plugins: [],
}
