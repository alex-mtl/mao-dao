import { ExclamationCircleIcon } from '@heroicons/react/20/solid';

export default function InputError({ message, className = '', ...props }) {
    return message ? (
        <p
            {...props}
            className={'flex items-center gap-1 text-sm text-danger-600 ' + className}
        >
            <ExclamationCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {message}
        </p>
    ) : null;
}
