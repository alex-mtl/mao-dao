import {
    Dialog,
    DialogPanel,
    Transition,
    TransitionChild,
} from '@headlessui/react';
import { Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import {
    HomeIcon,
    SparklesIcon,
    BookOpenIcon,
    Squares2X2Icon,
    PlusCircleIcon,
    PuzzlePieceIcon,
    UserPlusIcon,
    UserGroupIcon,
    UserCircleIcon,
    ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import ApplicationLogo from '@/Components/ApplicationLogo';
import ResponsiveNavLink from '@/Components/ResponsiveNavLink';
import Avatar from '@/Components/Avatar';
import useSectionRoutes from '@/hooks/useSectionRoutes';

function NavSection({ label, children }) {
    return (
        <div>
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-ink-400">
                {label}
            </p>
            <div className="mt-2 space-y-1">{children}</div>
        </div>
    );
}

export default function NavigationDrawer({ show, onClose, user }) {
    const { t } = useLaravelReactI18n();
    const { quizRoute, mafiaRoute } = useSectionRoutes();

    return (
        <Transition show={show} leave="duration-200">
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <TransitionChild
                    enter="ease-out duration-200"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-150"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-ink-900/50" />
                </TransitionChild>

                <div className="fixed inset-0 flex">
                    <TransitionChild
                        enter="ease-out duration-200"
                        enterFrom="-translate-x-full"
                        enterTo="translate-x-0"
                        leave="ease-in duration-150"
                        leaveFrom="translate-x-0"
                        leaveTo="-translate-x-full"
                    >
                        <DialogPanel className="flex h-full w-full max-w-xs flex-col bg-surface shadow-elevated">
                            <div className="flex items-center justify-between border-b border-warm-200 px-4 py-4">
                                <Link
                                    href={quizRoute('dashboard')}
                                    onClick={onClose}
                                    className="flex items-center gap-2"
                                >
                                    <ApplicationLogo className="h-8 w-auto fill-current text-primary-600" />
                                    <span className="font-heading text-lg font-bold text-ink-900">
                                        Quiz Platform
                                    </span>
                                </Link>
                            </div>

                            <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
                                <NavSection label={t('nav.section_main')}>
                                    <ResponsiveNavLink
                                        href={quizRoute('dashboard')}
                                        active={route().current('dashboard')}
                                        icon={HomeIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.dashboard')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={quizRoute('explorer.index')}
                                        active={route().current('explorer.*')}
                                        icon={SparklesIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.explorer')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={quizRoute('library.index')}
                                        active={route().current('library.*')}
                                        icon={BookOpenIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.library')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={quizRoute('quizzes.mine')}
                                        active={
                                            route().current('quizzes.mine') ||
                                            route().current('quizzes.edit') ||
                                            route().current('quizzes.preview')
                                        }
                                        icon={Squares2X2Icon}
                                        onClick={onClose}
                                    >
                                        {t('nav.my_quizzes')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={quizRoute('quizzes.create')}
                                        active={route().current('quizzes.create')}
                                        icon={PlusCircleIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.create_quiz')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={mafiaRoute('mafia.index')}
                                        active={route().current('mafia.*')}
                                        icon={PuzzlePieceIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.mafia')}
                                    </ResponsiveNavLink>
                                </NavSection>

                                <NavSection label={t('nav.section_social')}>
                                    <ResponsiveNavLink
                                        href={quizRoute('friends.index')}
                                        active={route().current('friends.*')}
                                        icon={UserPlusIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.friends')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={quizRoute('groups.index')}
                                        active={route().current('groups.*')}
                                        icon={UserGroupIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.groups')}
                                    </ResponsiveNavLink>
                                </NavSection>

                                <NavSection label={t('nav.section_account')}>
                                    <ResponsiveNavLink
                                        href={quizRoute('profile.edit')}
                                        active={route().current('profile.edit')}
                                        icon={UserCircleIcon}
                                        onClick={onClose}
                                    >
                                        {t('nav.profile')}
                                    </ResponsiveNavLink>
                                    <ResponsiveNavLink
                                        href={quizRoute('logout')}
                                        method="post"
                                        as="button"
                                        icon={ArrowRightOnRectangleIcon}
                                        className="w-full text-start"
                                    >
                                        {t('nav.log_out')}
                                    </ResponsiveNavLink>
                                </NavSection>
                            </nav>

                            <div className="flex items-center gap-3 border-t border-warm-200 px-4 py-4">
                                <Avatar name={user.name} src={user.profile_photo_url} size="sm" />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-ink-900">
                                        {user.name}
                                    </p>
                                    <p className="truncate text-xs text-ink-500">{user.email}</p>
                                </div>
                            </div>
                        </DialogPanel>
                    </TransitionChild>
                </div>
            </Dialog>
        </Transition>
    );
}
