export type ListenerCallback = (setValuesWasUsed: boolean) => void;
export type ListenerMap = { [T in string]?: ListenerCallback };
export type Validator<T, Error> = (values: T) => ErrorMap<T, Error>;

export type ChildFormMap<T, State, Error> = {
    [Key in keyof T]?: ChildFormState<T, State, Error, Key>;
};

export type DirtyMap<T> = {
    [Key in keyof T]?: boolean;
};

type ObjectOrArray = {
    [key: string]: any;
    [key: number]: any;
};

export type ErrorType<T, Error> = T extends ObjectOrArray
    ? ErrorMap<T, Error>
    : Error;

export type ErrorMap<T, Error> = {
    [Key in keyof T]?: ErrorType<T[Key], Error>;
};

export type DefaultError = string;
export type DefaultState = { isSubmitting: boolean };

function memberCopy<T>(value: T): T {
    if (Array.isArray(value)) {
        return [...value] as any;
    } else if (typeof value === "object") {
        return { ...value };
    } else {
        throw new Error("Can only memberCopy() arrays and objects.");
    }
}

export class FormState<T, State = DefaultState, Error = DefaultError> {
    public readonly formId = ++FormState.formCounter;
    public validator?: Validator<T, Error>;
    public validateOnChange: boolean;

    public readonly values: T;
    public readonly defaultValues: T;
    public readonly childMap: ChildFormMap<T, State, Error> = {};
    public readonly dirtyMap: DirtyMap<T> = {};
    public readonly errorMap: ErrorMap<T, Error> = {};

    private _state: State;
    private listeners: { [Key in keyof T]?: ListenerMap } = {};
    private anyListeners: ListenerMap = {};
    private counter = 0;

    protected static formCounter = 0;

    public constructor(
        values: T,
        defaultValues: T,
        defaultState: State,
        validator?: Validator<T, Error>,
        validateOnChange = true
    ) {
        this.values = memberCopy(values);
        this.defaultValues = memberCopy(defaultValues);
        this._state = memberCopy(defaultState);
        this.validator = validator;
        this.validateOnChange = validateOnChange;
    }

    public get state() {
        return this._state;
    }

    public get dirty() {
        return Object.keys(this.dirtyMap).some((e) => this.dirtyMap[e]);
    }

    public get error() {
        return Object.keys(this.errorMap).some((e) => this.errorMap[e]);
    }

    public setValueInternal<Key extends keyof T>(
        key: Key,
        value: T[Key] | undefined,
        dirty: boolean | undefined,
        validate: boolean,
        isDefault: boolean,
        notifyChild: boolean,
        notifyParent: boolean,
        fireAny: boolean
    ) {
        console.log(
            this.formId,
            "setValueInternal",
            key,
            value,
            dirty,
            isDefault
        );
        let map = isDefault ? this.defaultValues : this.values;
        if (value === undefined) {
            if (Array.isArray(map)) map.splice(key as number, 1);
            else delete map[key];
        } else {
            map[key] = value;
        }

        if (dirty !== undefined) this.dirtyMap[key] = dirty;

        if (notifyChild && value !== undefined) {
            let child = this.childMap[key];
            if (child) {
                child.setValues(value, isDefault, true, false);
                this.dirtyMap[key] = child.dirty;
            }
        }

        this.fireListeners(key, false);
        if (fireAny) {
            // Will be false when using setValues, he will call fireAnyListeners and notifyParentValues itself
            if (notifyParent) this.updateParentValues(isDefault);
            this.fireAnyListeners(false);
        }

        if (this.validator && validate) this.validate();
    }

    protected updateParentValues(_isDefault: boolean) {
        // Not implemented for root form, as it does not have a parent
    }

    protected updateParentErrors() {
        // Not implemented for root form, as it does not have a parent
    }

    protected updateParentState() {
        // Not implemented for root form, as it does not have a parent
    }

    public setValue<Key extends keyof T>(
        key: Key,
        value: T[Key] | undefined,
        validate: boolean = true,
        isDefault: boolean = false,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        if (typeof value === "object") {
            this.setValueInternal(
                key,
                value,
                undefined,
                validate,
                isDefault,
                notifyChild,
                notifyParent,
                fireAny
            );
        } else {
            if (
                (isDefault && this.defaultValues[key] === value) ||
                (!isDefault && this.values[key] === value)
            ) {
                console.log(
                    this.formId,
                    "already set",
                    value,
                    isDefault ? this.defaultValues[key] : this.values[key]
                );
                return false;
            }
            this.setValueInternal(
                key,
                value,
                isDefault
                    ? value !== this.values[key]
                    : value !== this.defaultValues[key],
                validate,
                isDefault,
                notifyChild,
                notifyParent,
                fireAny
            );
        }
        return true;
    }

    public setValues(
        values: T,
        isDefault: boolean = false,
        notifyChild: boolean = true,
        notifyParent: boolean = true
    ) {
        console.log(this.formId, "setValues", values, isDefault);

        // Copy the values to the local form object
        let newKeys = Object.keys(isDefault ? this.defaultValues : this.values);
        let localKeys = Object.keys(values);
        let mostKeys = newKeys.length > localKeys.length ? newKeys : localKeys;
        for (let i = 0; i < mostKeys.length; i++) {
            let key = mostKeys[i] as keyof T;
            this.setValue(
                key,
                values[key],
                false, // Will validate after all values are copied
                isDefault,
                notifyChild,
                notifyParent,
                false // Will call fireAnyListener after all values are copied, see 3 lines down
            );
        }
        if (notifyParent) this.updateParentValues(isDefault);
        this.fireAnyListeners(true);

        if (this.validator) this.validate();
    }

    public validate() {
        if (!this.validator) {
            console.warn(
                "validate() was called on a form which does not have a validator set."
            );
            return;
        }
        this.setErrors(this.validator(this.values));
    }

    public setError<Key extends keyof T>(
        key: Key,
        error: ErrorType<T[Key], Error> | undefined,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        if (this.errorMap[key] === error) return;

        if (!error) delete this.errorMap[key];
        else this.errorMap[key] = error;

        if (notifyChild) this.childMap[key]?.setErrors((error ?? {}) as any);
        this.fireListeners(key, false);
        if (fireAny) {
            if (notifyParent) this.updateParentErrors();
            this.fireAnyListeners(false);
        }
    }

    public setErrors(
        errors: ErrorMap<T, Error>,
        notifyChild: boolean = true,
        notifyParent: boolean = true
    ) {
        let localKeys = Object.keys(this.errorMap);
        let newKeys = Object.keys(errors);
        let mostKeys = newKeys.length > localKeys.length ? newKeys : localKeys;
        for (let i = 0; i < mostKeys.length; i++) {
            let key = mostKeys[i] as keyof T;
            this.setError(
                key,
                errors[key] as any,
                notifyChild,
                notifyParent,
                false // Will call fireAnyListener by itself, see 3 lines down
            );
        }
        if (notifyParent) this.updateParentErrors();
        this.fireAnyListeners(false);
    }

    public resetAll() {
        this.setValues(this.defaultValues);
    }

    public reset(key: keyof T) {
        this.setValue(key, this.defaultValues[key]);
    }

    public setState(
        state: State,
        notifyChild: boolean = true,
        notifyParent: boolean = true
    ) {
        this._state = state;

        let c = Object.keys(this.values);
        if (notifyChild)
            c.forEach((e) =>
                this.childMap[e]?.setState(state, notifyChild, notifyParent)
            );

        c.forEach((e) => this.fireListeners(e as keyof T, false));
        if (notifyParent) this.updateParentState();
        this.fireAnyListeners(false);
    }

    public listen(key: keyof T, listener: ListenerCallback): string {
        if (!this.listeners) this.listeners = {};
        let setters = this.listeners[key];
        if (!setters) {
            setters = {};
            this.listeners[key] = setters;
        }
        let id = "" + this.counter++;
        setters[id] = listener;
        return id;
    }

    public listenAny(listener: ListenerCallback) {
        if (!this.anyListeners) this.anyListeners = {};
        let id = "" + this.counter++;
        this.anyListeners[id] = listener;
        return id;
    }

    public ignoreAny(id: string) {
        if (!this.anyListeners) return;
        delete this.anyListeners[id];
    }

    public ignore(key: keyof T, id: string) {
        if (!this.listeners) return;
        let setters = this.listeners[key];
        if (!setters) {
            console.warn("Ignore was called for no reason", key, id);
            return;
        }
        delete setters[id];
    }

    protected fireListeners(key: keyof T, setValuesWasUsed: boolean) {
        let a = this.listeners[key];
        if (a) {
            let l = Object.keys(a!);
            l.forEach((e) => a![e]!(setValuesWasUsed));
        }
    }

    protected fireAnyListeners(setValuesWasUsed: boolean) {
        let al = Object.keys(this.anyListeners);
        al.forEach((e) => this.anyListeners[e]!(setValuesWasUsed));
    }
}

export class ChildFormState<
    Parent,
    ParentState,
    ParentError,
    Key extends keyof Parent
> extends FormState<Parent[Key], ParentState, ParentError> {
    public readonly name: Key;
    public readonly parent: FormState<Parent, ParentState, ParentError>;

    public constructor(
        parent: FormState<Parent, ParentState, ParentError>,
        name: Key
    ) {
        super(
            parent.values[name] ?? ({} as any),
            parent.defaultValues[name] ?? ({} as any),
            parent.state
        );
        this.parent = parent;
        this.name = name;
        parent.childMap[name] = this;
    }

    protected updateParentValues(isDefault: boolean) {
        this.parent.setValueInternal(
            this.name,
            isDefault
                ? memberCopy(this.defaultValues)
                : memberCopy(this.values),
            this.dirty,
            true,
            isDefault,
            false,
            true,
            true
        );
    }

    protected updateParentErrors() {
        this.parent.setError(
            this.name,
            this.error ? (memberCopy(this.errorMap) as any) : undefined,
            false,
            true
        );
    }

    protected updateParentState() {
        this.parent.setState(memberCopy(this.state), false, true);
    }
}