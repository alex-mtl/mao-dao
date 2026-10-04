import { useState } from 'react';
import RaceLayout from '@/Layouts/RaceLayout';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import Timer from '@/Components/Race/Timer';
import Leaderboard from '@/Components/Race/Leaderboard';
import QuestionResults from '@/Components/Race/QuestionResults';
import useRaceChannel from '@/hooks/useRaceChannel';
import useCountdown from '@/hooks/useCountdown';
import { CheckIcon } from '@heroicons/react/20/solid';
import { Head, Link, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

const ANSWER_LABELS = ['A', 'B', 'C', 'D'];

function Countdown({ goAt }) {
    const { t } = useLaravelReactI18n();
    const remainingMs = useCountdown(goAt);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    return (
        <div className="animate-in flex flex-col items-center py-12 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                {t('race.starting')}
            </p>
            <p className="mt-2 font-heading text-7xl font-extrabold text-primary-600">
                {remainingSeconds > 0 ? remainingSeconds : t('race.go')}
            </p>
        </div>
    );
}

function LeaveLink({ onClick, label }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="mt-6 block w-full rounded text-center text-xs text-ink-400 hover:text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
            {label}
        </button>
    );
}

export default function Play({ code, quizTitle, questionTimeLimitSeconds, ...initialState }) {
    const { t } = useLaravelReactI18n();
    const [state, setState] = useRaceChannel(code, initialState);
    const [submitting, setSubmitting] = useState(false);

    const selectAnswer = (answerId) => {
        if (state.hasAnswered || submitting) {
            return;
        }

        setSubmitting(true);
        setState((prev) => ({ ...prev, hasAnswered: true, selectedAnswerId: answerId }));

        router.post(
            route('race.answer', code),
            { answer_id: answerId },
            { preserveScroll: true, preserveState: true, onFinish: () => setSubmitting(false) },
        );
    };

    const leaveRace = () => router.post(route('race.leave', code));
    const playAgain = () => router.post(route('race.play-again', code));

    const wasCorrect = state.hasAnswered && state.selectedAnswerId === state.correctAnswerId;

    // A visually-hidden live region for screen-reader users, so major
    // game-state changes (a new question, time's up, final results) are
    // announced even though they're driven by push events, not a page
    // navigation a screen reader would otherwise notice on its own.
    let announcement = '';
    if (state.status === 'starting') {
        announcement = t('race.starting');
    } else if (state.status === 'question' && state.question) {
        announcement = `${t('race.question_progress', {
            current: state.questionIndex + 1,
            total: state.totalQuestions,
        })}. ${state.question.text}`;
    } else if (state.status === 'question_results') {
        announcement = state.hasAnswered
            ? wasCorrect
                ? t('race.correct')
                : t('race.incorrect')
            : t('race.no_answer');
    } else if (state.status === 'finished') {
        announcement = t('race.final_results');
    }

    return (
        <RaceLayout>
            <Head title={quizTitle} />

            <div className="sr-only" role="status" aria-live="polite">
                {announcement}
            </div>

            <p className="text-center text-sm font-medium text-ink-500">{quizTitle}</p>

            {state.status === 'starting' && <Countdown goAt={state.goAt} />}

            {state.status === 'question' && state.question && (
                <div key={state.question.id} className="animate-in mt-4">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-400">
                        <span>
                            {t('race.question_progress', {
                                current: state.questionIndex + 1,
                                total: state.totalQuestions,
                            })}
                        </span>
                    </div>

                    <Timer
                        deadlineAt={state.deadlineAt}
                        totalSeconds={questionTimeLimitSeconds}
                        className="mt-2"
                    />

                    <h2 className="mt-4 text-center font-heading text-xl font-bold text-ink-900">
                        {state.question.text}
                    </h2>

                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {state.question.answers.map((answer, index) => {
                            const selected = state.selectedAnswerId === answer.id;

                            return (
                                <button
                                    key={answer.id}
                                    type="button"
                                    disabled={state.hasAnswered}
                                    onClick={() => selectAnswer(answer.id)}
                                    aria-pressed={selected}
                                    className={`relative flex items-center gap-3 rounded-xl border-2 p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                                        selected
                                            ? 'border-primary-600 bg-primary-50'
                                            : 'border-warm-200 bg-surface hover:border-primary-300'
                                    } ${state.hasAnswered && !selected ? 'opacity-50' : ''}`}
                                >
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warm-100 font-bold text-ink-700">
                                        {ANSWER_LABELS[index]}
                                    </span>
                                    <span className="font-medium text-ink-900">{answer.text}</span>
                                    {selected && (
                                        <CheckIcon
                                            className="absolute right-3 top-3 h-5 w-5 text-primary-600"
                                            aria-hidden="true"
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {state.hasAnswered && (
                        <p className="mt-4 text-center text-sm text-ink-500">
                            {t('race.answer_locked')}
                        </p>
                    )}

                    <LeaveLink onClick={leaveRace} label={t('race.leave_button')} />
                </div>
            )}

            {state.status === 'question_results' && (
                <div className="animate-in mt-4">
                    <QuestionResults
                        hasAnswered={state.hasAnswered}
                        wasCorrect={wasCorrect}
                        leaderboard={state.leaderboard ?? []}
                    />
                    <LeaveLink onClick={leaveRace} label={t('race.leave_button')} />
                </div>
            )}

            {state.status === 'finished' && (
                <div className="animate-in mt-4">
                    <p className="text-center font-heading text-2xl font-bold text-ink-900">
                        {t('race.final_results')}
                    </p>
                    <Leaderboard players={state.leaderboard ?? []} className="mt-4" />

                    {state.newRoomCode && (
                        <Link
                            href={route('race.show', state.newRoomCode)}
                            className="mt-4 block rounded-lg border border-primary-200 bg-primary-50 p-3 text-center text-sm font-semibold text-primary-700 hover:bg-primary-100"
                        >
                            {t('race.new_race_started')}
                        </Link>
                    )}

                    <div className="mt-6 flex flex-col gap-3">
                        {state.isHost && !state.newRoomCode && (
                            <PrimaryButton
                                className="w-full justify-center py-3 text-base"
                                onClick={playAgain}
                            >
                                {t('race.play_again_button')}
                            </PrimaryButton>
                        )}
                        <SecondaryButton className="w-full justify-center" onClick={leaveRace}>
                            {t('race.leave_button')}
                        </SecondaryButton>
                    </div>
                </div>
            )}
        </RaceLayout>
    );
}
