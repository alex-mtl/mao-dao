import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import InputLabel from '@/Components/InputLabel';
import TextInput from '@/Components/TextInput';
import InputError from '@/Components/InputError';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import DangerButton from '@/Components/DangerButton';
import { Head, Link, router, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';
import { formatMinutes } from '@/utils/duration';
import {
    PlusIcon,
    TrashIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    CheckCircleIcon,
    EyeIcon,
    ClockIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

const emptyAnswer = () => ({ text: '', is_correct: false });

const emptyQuestion = () => ({
    text: '',
    answers: [emptyAnswer(), emptyAnswer(), emptyAnswer(), emptyAnswer()],
});

const selectClasses =
    'block w-full rounded-lg border-warm-300 text-ink-900 shadow-soft focus:border-primary-500 focus:ring-primary-500';

export default function Editor({ quiz, tags }) {
    const { t } = useLaravelReactI18n();
    const currentUser = usePage().props.auth.user;
    const localeOptions = usePage().props.locale_options;

    const isEditing = quiz !== null;

    const [title, setTitle] = useState(quiz?.title ?? '');
    const [description, setDescription] = useState(quiz?.description ?? '');
    const [language, setLanguage] = useState(quiz?.language ?? currentUser.ui_language);
    const [allowCopying, setAllowCopying] = useState(quiz?.allow_copying ?? true);
    const [estimatedHours, setEstimatedHours] = useState(
        quiz?.estimated_minutes ? Math.floor(quiz.estimated_minutes / 60) : 0,
    );
    const [estimatedMinutes, setEstimatedMinutes] = useState(
        quiz?.estimated_minutes ? quiz.estimated_minutes % 60 : 0,
    );
    const [tagIds, setTagIds] = useState(quiz?.tag_ids ?? []);
    const [questions, setQuestions] = useState(
        quiz?.questions?.length ? quiz.questions : [],
    );
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState({});

    const toggleTag = (tagId) => {
        setTagIds((current) =>
            current.includes(tagId)
                ? current.filter((id) => id !== tagId)
                : [...current, tagId],
        );
    };

    const addQuestion = () => {
        setQuestions((current) => [...current, emptyQuestion()]);
    };

    const removeQuestion = (index) => {
        setQuestions((current) => current.filter((_, i) => i !== index));
    };

    const moveQuestion = (index, direction) => {
        setQuestions((current) => {
            const target = index + direction;

            if (target < 0 || target >= current.length) {
                return current;
            }

            const updated = [...current];
            [updated[index], updated[target]] = [updated[target], updated[index]];

            return updated;
        });
    };

    const updateQuestionText = (index, value) => {
        setQuestions((current) =>
            current.map((q, i) => (i === index ? { ...q, text: value } : q)),
        );
    };

    const updateAnswerText = (qIndex, aIndex, value) => {
        setQuestions((current) =>
            current.map((q, i) => {
                if (i !== qIndex) {
                    return q;
                }

                return {
                    ...q,
                    answers: q.answers.map((a, j) =>
                        j === aIndex ? { ...a, text: value } : a,
                    ),
                };
            }),
        );
    };

    const setCorrectAnswer = (qIndex, aIndex) => {
        setQuestions((current) =>
            current.map((q, i) => {
                if (i !== qIndex) {
                    return q;
                }

                return {
                    ...q,
                    answers: q.answers.map((a, j) => ({
                        ...a,
                        is_correct: j === aIndex,
                    })),
                };
            }),
        );
    };

    const totalEstimatedMinutes = estimatedHours * 60 + estimatedMinutes;

    const payload = () => ({
        title,
        description,
        language,
        allow_copying: allowCopying,
        estimated_minutes: totalEstimatedMinutes > 0 ? totalEstimatedMinutes : null,
        tag_ids: tagIds,
        questions,
    });

    const saveDraft = () => {
        setProcessing(true);
        setErrors({});

        const options = {
            preserveScroll: true,
            onError: (errs) => setErrors(errs),
            onFinish: () => setProcessing(false),
        };

        if (isEditing) {
            router.put(route('quizzes.update', quiz.id), payload(), options);
        } else {
            router.post(route('quizzes.store'), payload(), options);
        }
    };

    const publish = () => {
        setProcessing(true);
        setErrors({});

        router.post(route('quizzes.publish', quiz.id), {}, {
            preserveScroll: true,
            onError: (errs) => setErrors(errs),
            onFinish: () => setProcessing(false),
        });
    };

    const deleteQuiz = () => {
        if (window.confirm(t('quiz_editor.confirm_delete'))) {
            router.delete(route('quizzes.destroy', quiz.id));
        }
    };

    const heading = isEditing ? t('quiz_editor.edit_title') : t('quiz_editor.create_title');

    return (
        <AuthenticatedLayout header={<PageHeader title={heading} />}>
            <Head title={heading} />

            <div className="py-8">
                <div className="mx-auto max-w-4xl space-y-6 px-4 sm:px-6 lg:px-8">
                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        <div className="space-y-4">
                            <div>
                                <InputLabel htmlFor="title" value={t('quiz_editor.title_label')} />
                                <TextInput
                                    id="title"
                                    className="mt-1 block w-full"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                />
                                <InputError message={errors.title} className="mt-2" />
                            </div>

                            <div>
                                <InputLabel htmlFor="description" value={t('quiz_editor.description_label')} />
                                <textarea
                                    id="description"
                                    className={`mt-1 ${selectClasses}`}
                                    rows={3}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                                <InputError message={errors.description} className="mt-2" />
                            </div>

                            <div>
                                <InputLabel htmlFor="language" value={t('quiz_editor.language_label')} />
                                <select
                                    id="language"
                                    className={`mt-1 ${selectClasses}`}
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                >
                                    {localeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <InputLabel value={t('quiz_editor.tags_label')} />
                                <div className="mt-1 flex flex-wrap gap-2">
                                    {tags.map((tag) => {
                                        const selected = tagIds.includes(tag.id);

                                        return (
                                            <button
                                                type="button"
                                                key={tag.id}
                                                onClick={() => toggleTag(tag.id)}
                                                className={
                                                    'rounded-full border px-3 py-1 text-sm font-medium transition ' +
                                                    (selected
                                                        ? 'border-primary-600 bg-primary-600 text-white'
                                                        : 'border-warm-300 text-ink-600 hover:bg-warm-100')
                                                }
                                            >
                                                {tag.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={allowCopying}
                                        onChange={(e) => setAllowCopying(e.target.checked)}
                                        className="rounded border-warm-300 text-primary-600 shadow-soft focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-ink-700">
                                        {t('quiz_editor.allow_copying_label')}
                                    </span>
                                </label>
                                <p className="mt-1 text-xs text-ink-400">
                                    {t('quiz_editor.allow_copying_description')}
                                </p>
                            </div>

                            <div>
                                <InputLabel value={t('quiz_editor.estimated_time_label')} />
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <input
                                        type="number"
                                        min={0}
                                        max={99}
                                        className="block w-20 rounded-lg border-warm-300 text-ink-900 shadow-soft focus:border-primary-500 focus:ring-primary-500"
                                        value={estimatedHours}
                                        onChange={(e) =>
                                            setEstimatedHours(
                                                Math.max(0, Math.min(99, Number(e.target.value) || 0)),
                                            )
                                        }
                                    />
                                    <span className="text-sm text-ink-500">
                                        {t('quiz_editor.hours_label')}
                                    </span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={59}
                                        className="block w-20 rounded-lg border-warm-300 text-ink-900 shadow-soft focus:border-primary-500 focus:ring-primary-500"
                                        value={estimatedMinutes}
                                        onChange={(e) =>
                                            setEstimatedMinutes(
                                                Math.max(0, Math.min(59, Number(e.target.value) || 0)),
                                            )
                                        }
                                    />
                                    <span className="text-sm text-ink-500">
                                        {t('quiz_editor.minutes_label')}
                                    </span>
                                    {totalEstimatedMinutes > 0 && (
                                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700">
                                            <ClockIcon className="h-4 w-4" aria-hidden="true" />
                                            {formatMinutes(totalEstimatedMinutes)}
                                        </span>
                                    )}
                                </div>
                                <InputError message={errors.estimated_minutes} className="mt-2" />
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        <h3 className="font-heading text-lg font-semibold text-ink-900">
                            {t('quiz_editor.questions_heading')}
                        </h3>

                        <InputError message={errors.questions} className="mt-2" />

                        <div className="mt-4 space-y-5">
                            {questions.map((question, qIndex) => (
                                <div
                                    key={qIndex}
                                    className="rounded-xl border border-warm-200 bg-warm-50 p-4"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex flex-1 items-start gap-3">
                                            <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
                                                {qIndex + 1}
                                            </span>
                                            <div className="flex-1">
                                                <TextInput
                                                    className="block w-full"
                                                    maxLength={150}
                                                    placeholder={t('quiz_editor.question_placeholder')}
                                                    value={question.text}
                                                    onChange={(e) =>
                                                        updateQuestionText(qIndex, e.target.value)
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 gap-1">
                                            <button
                                                type="button"
                                                onClick={() => moveQuestion(qIndex, -1)}
                                                disabled={qIndex === 0}
                                                aria-label={t('quiz_editor.move_up')}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-warm-200 disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                                <ArrowUpIcon className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveQuestion(qIndex, 1)}
                                                disabled={qIndex === questions.length - 1}
                                                aria-label={t('quiz_editor.move_down')}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-warm-200 disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                                <ArrowDownIcon className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeQuestion(qIndex)}
                                                aria-label={t('quiz_editor.remove_question')}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-danger-500 hover:bg-danger-50"
                                            >
                                                <TrashIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 gap-2 pl-10 sm:grid-cols-2">
                                        {question.answers.map((answer, aIndex) => (
                                            <button
                                                type="button"
                                                key={aIndex}
                                                onClick={() => setCorrectAnswer(qIndex, aIndex)}
                                                className={
                                                    'flex items-center gap-2 rounded-lg border p-2 text-left transition ' +
                                                    (answer.is_correct
                                                        ? 'border-success-400 bg-success-50'
                                                        : 'border-warm-300 bg-surface hover:border-warm-400')
                                                }
                                                title={t('quiz_editor.correct_answer_label')}
                                            >
                                                {answer.is_correct ? (
                                                    <CheckCircleSolidIcon className="h-5 w-5 shrink-0 text-success-600" />
                                                ) : (
                                                    <CheckCircleIcon className="h-5 w-5 shrink-0 text-ink-300" />
                                                )}
                                                <input
                                                    maxLength={32}
                                                    placeholder={t(
                                                        'quiz_editor.answer_placeholder',
                                                        { number: aIndex + 1 },
                                                    )}
                                                    value={answer.text}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) =>
                                                        updateAnswerText(
                                                            qIndex,
                                                            aIndex,
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full border-0 bg-transparent p-0 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-0"
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-4">
                            <SecondaryButton type="button" onClick={addQuestion}>
                                <PlusIcon className="h-4 w-4" aria-hidden="true" />
                                {t('quiz_editor.add_question')}
                            </SecondaryButton>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                            <PrimaryButton loading={processing} onClick={saveDraft}>
                                {t('quiz_editor.save_draft')}
                            </PrimaryButton>

                            {isEditing && (
                                <>
                                    <Link href={route('quizzes.preview', quiz.id)}>
                                        <SecondaryButton>
                                            <EyeIcon className="h-4 w-4" aria-hidden="true" />
                                            {t('quiz_editor.preview')}
                                        </SecondaryButton>
                                    </Link>

                                    {quiz.status !== 'published' && (
                                        <PrimaryButton loading={processing} onClick={publish}>
                                            {t('quiz_editor.publish')}
                                        </PrimaryButton>
                                    )}
                                </>
                            )}
                        </div>

                        {isEditing && (
                            <DangerButton onClick={deleteQuiz}>
                                <TrashIcon className="h-4 w-4" aria-hidden="true" />
                                {t('quiz_editor.delete_quiz')}
                            </DangerButton>
                        )}
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
