export default function Checkbox({ className = '', ...props }) {
    return (
        <input
            {...props}
            type="checkbox"
            className={
                'rounded border-warm-300 text-primary-600 shadow-soft focus:ring-primary-500 ' +
                className
            }
        />
    );
}
