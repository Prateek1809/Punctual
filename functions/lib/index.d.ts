import * as functions from 'firebase-functions';
export declare const createEmployee: functions.https.CallableFunction<any, Promise<{
    uid: any;
}>, unknown>;
export declare const punchIn: functions.https.CallableFunction<any, Promise<{
    status: string;
    verified: boolean;
}>, unknown>;
export declare const punchOut: functions.https.CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const approveLeave: functions.https.CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const rejectLeave: functions.https.CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const cancelLeave: functions.https.CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const nightlyAttendanceJob: any;
export declare const yearlyReset: any;
export declare const monthlyLeaveAllocation: any;
//# sourceMappingURL=index.d.ts.map